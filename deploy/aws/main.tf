locals {
  environment_name = "${var.project_name}-${var.environment}"
  namespace        = "${var.environment}.pharmacy.internal"

  backend_services = {
    identity-service = {
      port = 3001
    }
    catalog-service = {
      port = 3002
    }
    inventory-service = {
      port = 3004
    }
    sales-service = {
      port = 3005
    }
    payment-service = {
      port = 3006
    }
    operations-query-service = {
      port = 3007
    }
    chatbot-service = {
      port = 3008
    }
    search-service = {
      port = 3009
    }
    ops-console-service = {
      port = 3010
    }
  }

  path_rules = {
    identity-service = {
      priority = 10
      paths    = ["/auth*", "/admin*", "/customers*"]
      service  = "identity-service"
    }
    catalog-service = {
      priority = 20
      paths    = ["/sites*", "/storage-locations*", "/products*", "/suppliers*", "/pricing*"]
      service  = "catalog-service"
    }
    # An ALB rule takes at most 5 condition values, so the catalog paths are split over two rules.
    catalog-stores = {
      priority = 25
      paths    = ["/stores*", "/availability*"]
      service  = "catalog-service"
    }
    procurement = {
      priority = 30
      paths    = ["/procurement*"]
      service  = "inventory-service"
    }
    inventory-service = {
      priority = 40
      paths    = ["/inventory*"]
      service  = "inventory-service"
    }
    sales-service = {
      priority = 50
      paths    = ["/carts*", "/orders*", "/delivery*", "/prescriptions*", "/counter-transactions*"]
      service  = "sales-service"
    }
    sales-targets = {
      priority = 55
      paths    = ["/sales-targets*"]
      service  = "sales-service"
    }
    payments = {
      priority = 60
      paths    = ["/payments*"]
      service  = "payment-service"
    }
    operations = {
      priority = 70
      paths    = ["/operations*", "/dashboard*", "/finance*", "/audit*"]
      service  = "operations-query-service"
    }
    chatbot = {
      priority = 80
      paths    = ["/chatbot*"]
      service  = "chatbot-service"
    }
    ops-console = {
      priority = 90
      paths    = ["/system*"]
      service  = "ops-console-service"
    }
  }

  # Which backend services each service calls. Each becomes <NAME>_SERVICE_URL pointing at its Cloud Map name.
  service_dependencies = {
    inventory-service        = ["catalog-service", "identity-service"]
    sales-service            = ["catalog-service", "inventory-service", "identity-service"]
    payment-service          = ["catalog-service", "sales-service"]
    operations-query-service = ["catalog-service", "inventory-service", "sales-service", "payment-service"]
    chatbot-service          = ["catalog-service"]
    search-service           = ["catalog-service"]
    ops-console-service      = ["identity-service", "catalog-service", "search-service", "inventory-service", "sales-service", "payment-service", "operations-query-service", "chatbot-service"]
  }

  # Non-secret settings TFCore owns. The OTLP endpoint is unreachable unless otel_collector_enabled, so spans are dropped.
  service_environment = {
    for name in keys(local.backend_services) : name => merge(
      { OTEL_EXPORTER_OTLP_ENDPOINT = "http://otel-collector.${local.namespace}:4318" },
      name == "identity-service" || name == "search-service" ? {} : { IDENTITY_JWKS_URL = "http://identity-service.${local.namespace}:${local.backend_services["identity-service"].port}/.well-known/jwks.json" },
      { for dep in lookup(local.service_dependencies, name, []) : "${replace(upper(dep), "-", "_")}_URL" => "http://${dep}.${local.namespace}:${local.backend_services[dep].port}" },
      name == "ops-console-service" ? {
        PROMETHEUS_URL     = "http://prometheus.${local.namespace}:9090"
        GRAFANA_PUBLIC_URL = "https://grafana.invalid"
      } : {},
    )
  }

  # search-service is a Go binary: no node entrypoint, no Drizzle migration, and its own health endpoint.
  go_services = ["search-service"]

  health_check_paths = {
    search-service = "/healthz"
  }
  # search-service and ops-console-service own no database, so neither has a migration task.
  databaseless_services = ["search-service", "ops-console-service"]
  migrating_services    = { for name, service in local.backend_services : name => service if !contains(local.databaseless_services, name) }

  embedder_name        = "embedder"
  embedder_port        = 80
  embedder_model_id    = "intfloat/multilingual-e5-small"
  embedder_url         = "http://${local.embedder_name}.${local.namespace}:${local.embedder_port}/v1"
  embedder_task_cpu    = 2048
  embedder_task_memory = 4096

  # The clients' four AI_EMBEDDING_* settings are set together, and the key is the secret the embedder reads, so the two
  # sides cannot drift apart. Both are empty unless embedder_enabled, because the group is all or none (AGENTS.md).
  embedder_client_services = var.embedder_enabled ? ["catalog-service", "search-service"] : []
  embedder_client_environment = var.embedder_enabled ? {
    AI_EMBEDDING_PROVIDER = "openai-compatible"
    AI_EMBEDDING_BASE_URL = local.embedder_url
    AI_EMBEDDING_MODEL    = local.embedder_model_id
  } : {}
  embedder_client_secrets = var.embedder_enabled ? {
    AI_EMBEDDING_API_KEY = local.secret_arn["shared/AI_EMBEDDING_API_KEY"]
  } : {}

  # Container environment and secrets per backend service. The service and the migration task definitions both use these.
  task_environment = {
    for name in keys(local.backend_services) : name => merge(
      lookup(var.service_environment_extra, name, {}),
      lookup(local.web_service_environment, name, {}),
      local.service_environment[name],
      contains(local.embedder_client_services, name) ? local.embedder_client_environment : {},
    )
  }
  task_secrets = {
    for name in keys(local.backend_services) : name => merge(
      local.service_secret_arns[name],
      contains(local.embedder_client_services, name) ? local.embedder_client_secrets : {},
    )
  }

  # The execution role reads every secret the stack creates.
  execution_secret_arns = concat(values(local.secret_arn), [for parameter in aws_ssm_parameter.catalog_media : parameter.arn], aws_ssm_parameter.grafana_admin_password[*].arn)
}

resource "aws_security_group" "vpc_link" {
  name        = "${local.environment_name}-vpc-link"
  description = "Security group for API Gateway HTTP API VPC link"
  vpc_id      = aws_vpc.this.id

  tags = {
    Name = "${local.environment_name}-vpc-link"
  }
}

resource "aws_security_group" "alb" {
  name        = "${local.environment_name}-alb"
  description = "Security group for internal Application Load Balancer"
  vpc_id      = aws_vpc.this.id

  tags = {
    Name = "${local.environment_name}-alb"
  }
}

resource "aws_security_group" "ecs_tasks" {
  name        = "${local.environment_name}-ecs-tasks"
  description = "Security group for backend ECS Fargate tasks"
  vpc_id      = aws_vpc.this.id

  tags = {
    Name = "${local.environment_name}-ecs-tasks"
  }
}

resource "aws_security_group_rule" "vpc_link_egress_alb" {
  type                     = "egress"
  description              = "Allow outbound HTTP traffic from VPC link to internal ALB"
  from_port                = 80
  to_port                  = 80
  protocol                 = "tcp"
  security_group_id        = aws_security_group.vpc_link.id
  source_security_group_id = aws_security_group.alb.id
}

resource "aws_security_group_rule" "alb_ingress_vpc_link" {
  type                     = "ingress"
  description              = "Allow inbound HTTP traffic from API Gateway VPC link"
  from_port                = 80
  to_port                  = 80
  protocol                 = "tcp"
  security_group_id        = aws_security_group.alb.id
  source_security_group_id = aws_security_group.vpc_link.id
}

resource "aws_security_group_rule" "alb_egress_tasks" {
  type                     = "egress"
  description              = "Allow outbound HTTP traffic from ALB to backend ECS tasks"
  from_port                = 3001
  to_port                  = 3010
  protocol                 = "tcp"
  security_group_id        = aws_security_group.alb.id
  source_security_group_id = aws_security_group.ecs_tasks.id
}

resource "aws_security_group_rule" "tasks_ingress_alb" {
  type                     = "ingress"
  description              = "Allow inbound traffic from internal ALB on backend service ports"
  from_port                = 3001
  to_port                  = 3010
  protocol                 = "tcp"
  security_group_id        = aws_security_group.ecs_tasks.id
  source_security_group_id = aws_security_group.alb.id
}

resource "aws_security_group_rule" "tasks_ingress_self" {
  type              = "ingress"
  description       = "Allow service-to-service Cloud Map communication between ECS tasks"
  from_port         = 3001
  to_port           = 3010
  protocol          = "tcp"
  security_group_id = aws_security_group.ecs_tasks.id
  self              = true
}

resource "aws_security_group_rule" "tasks_ingress_rabbitmq" {
  type              = "ingress"
  description       = "Allow backend ECS tasks to reach RabbitMQ (AMQP and the management API)"
  from_port         = 5672
  to_port           = 15672
  protocol          = "tcp"
  security_group_id = aws_security_group.ecs_tasks.id
  self              = true
}

resource "aws_security_group_rule" "tasks_ingress_typesense" {
  type              = "ingress"
  description       = "Allow backend ECS tasks to reach Typesense"
  from_port         = 8108
  to_port           = 8108
  protocol          = "tcp"
  security_group_id = aws_security_group.ecs_tasks.id
  self              = true
}

resource "aws_security_group_rule" "tasks_egress_all" {
  type              = "egress"
  description       = "Allow outbound traffic for third-party APIs, data stores, and NAT gateway"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  security_group_id = aws_security_group.ecs_tasks.id
  cidr_blocks       = ["0.0.0.0/0"]
}

resource "aws_security_group" "embedder" {
  count = var.embedder_enabled ? 1 : 0

  name        = "${local.environment_name}-embedder"
  description = "Security group for the embedder ECS Fargate task"
  vpc_id      = aws_vpc.this.id

  tags = {
    Name = "${local.environment_name}-embedder"
  }
}

# Attached to the catalog-service and search-service tasks only. The embedder group allows traffic from this group, not
# from the shared ECS tasks group, so no other backend service can reach the embedder.
resource "aws_security_group" "embedder_client" {
  count = var.embedder_enabled ? 1 : 0

  name        = "${local.environment_name}-embedder-client"
  description = "Attached to catalog-service and search-service ECS tasks, the only clients allowed to reach the embedder"
  vpc_id      = aws_vpc.this.id

  tags = {
    Name = "${local.environment_name}-embedder-client"
  }
}

resource "aws_security_group_rule" "embedder_ingress_clients" {
  count = var.embedder_enabled ? 1 : 0

  type                     = "ingress"
  description              = "Allow inbound HTTP on port 80 from catalog-service and search-service tasks only"
  from_port                = 80
  to_port                  = 80
  protocol                 = "tcp"
  security_group_id        = aws_security_group.embedder[0].id
  source_security_group_id = aws_security_group.embedder_client[0].id
}

resource "aws_security_group_rule" "embedder_egress_all" {
  count = var.embedder_enabled ? 1 : 0

  type              = "egress"
  description       = "Allow outbound traffic for image pulls, CloudWatch Logs, SSM, and NAT gateway"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  security_group_id = aws_security_group.embedder[0].id
  cidr_blocks       = ["0.0.0.0/0"]
}

resource "aws_ecs_cluster" "this" {
  name = local.environment_name

  setting {
    name  = "containerInsights"
    value = "disabled"
  }
}

resource "aws_cloudwatch_log_group" "service" {
  for_each          = toset(concat(keys(local.backend_services), ["ops", "typesense", "rabbitmq"]))
  name              = "/ecs/${local.environment_name}/${each.key}"
  retention_in_days = var.log_retention_in_days
}

resource "aws_cloudwatch_log_group" "embedder" {
  count = var.embedder_enabled ? 1 : 0

  name              = "/ecs/${local.environment_name}/${local.embedder_name}"
  retention_in_days = var.log_retention_in_days
}

resource "aws_iam_role" "task_execution" {
  name = "${local.environment_name}-ecs-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "task_execution" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_policy" "task_execution_secrets" {
  name        = "${local.environment_name}-ecs-execution-secrets"
  description = "Allow ECS task execution role to read the secrets this stack creates"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ssm:GetParameters"]
        Resource = local.execution_secret_arns
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "task_execution_secrets" {
  role       = aws_iam_role.task_execution.name
  policy_arn = aws_iam_policy.task_execution_secrets.arn
}

resource "aws_iam_role" "task" {
  name = "${local.environment_name}-ecs-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_lb" "internal" {
  name               = substr("${local.environment_name}-internal", 0, 32)
  internal           = true
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.private[*].id
}

resource "aws_lb_target_group" "service" {
  for_each = local.backend_services

  name        = trimsuffix(substr("${local.environment_name}-${replace(each.key, "_", "-")}", 0, 32), "-")
  port        = each.value.port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.this.id

  # A stopped task leaves the load balancer after 30 s instead of 300 s. With maximumPercent 100 the replacement cannot
  # start before then, so this is most of the recovery time after a task dies.
  deregistration_delay = 30

  health_check {
    enabled             = true
    path                = lookup(local.health_check_paths, each.key, "/health/ready")
    protocol            = "HTTP"
    matcher             = "200-399"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "internal" {
  load_balancer_arn = aws_lb.internal.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "fixed-response"

    fixed_response {
      content_type = "application/json"
      message_body = jsonencode({ title = "Not Found", status = 404 })
      status_code  = "404"
    }
  }
}

resource "aws_lb_listener_rule" "service" {
  for_each = local.path_rules

  listener_arn = aws_lb_listener.internal.arn
  priority     = each.value.priority

  condition {
    path_pattern {
      values = each.value.paths
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.service[each.value.service].arn
  }
}

# GET /api/products is the only route search-service owns. The API Gateway strips /api, so the ALB sees exactly
# /products. The exact path (no wildcard) keeps /products/{id} and every other method on catalog-service, whose rule
# (priority 20) is evaluated after this one and so takes everything this one does not match.
resource "aws_lb_listener_rule" "search_products" {
  listener_arn = aws_lb_listener.internal.arn
  priority     = 15

  condition {
    path_pattern {
      values = ["/products"]
    }
  }

  condition {
    http_request_method {
      values = ["GET"]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.service["search-service"].arn
  }
}

resource "aws_service_discovery_private_dns_namespace" "this" {
  name = local.namespace
  vpc  = aws_vpc.this.id
}

resource "aws_service_discovery_service" "service" {
  for_each = local.backend_services

  name = each.key

  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.this.id
    dns_records {
      ttl  = 10
      type = "A"
    }
    routing_policy = "MULTIVALUE"
  }

  health_check_custom_config {
    failure_threshold = 1
  }
}

resource "aws_ecs_task_definition" "service" {
  for_each = local.backend_services

  family                   = "${local.environment_name}-${each.key}"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    merge(
      {
        name      = each.key
        image     = "${aws_ecr_repository.service[each.key].repository_url}:${var.image_tag}"
        essential = true
        cpu       = var.task_cpu
        memory    = var.task_memory
        portMappings = [{
          containerPort = each.value.port
          hostPort      = each.value.port
          protocol      = "tcp"
        }]
        environment = concat(
          contains(local.go_services, each.key) ? [] : [{ name = "NODE_ENV", value = "production" }],
          [{ name = "PORT", value = tostring(each.value.port) }],
          [
            for name, value in local.task_environment[each.key] : {
              name  = name
              value = value
            }
          ],
        )
        secrets = [
          for name, value_from in local.task_secrets[each.key] : {
            name      = name
            valueFrom = value_from
          }
        ]
        readonlyRootFilesystem = true
        logConfiguration = {
          logDriver = "awslogs"
          options = {
            "awslogs-group"         = aws_cloudwatch_log_group.service[each.key].name
            "awslogs-region"        = var.aws_region
            "awslogs-stream-prefix" = "ecs"
          }
        }
      },
      # Node services run `node dist/main.js` as the node user with a node health probe. The Go image keeps its own
      # entrypoint and user, and its health is checked by the ALB target group alone.
      # merge() skips null arguments, so the Go branch is null, not {}: an object with these attributes and {} have no
      # common type, and Terraform rejects that conditional.
      contains(local.go_services, each.key) ? null : {
        user    = "node"
        command = ["node", "dist/main.js"]
        healthCheck = {
          command     = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:' + process.env.PORT + '/health/ready').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))\""]
          interval    = 30
          timeout     = 5
          retries     = 3
          startPeriod = 30
        }
      },
    )
  ])
}

resource "aws_ecs_task_definition" "migration" {
  for_each = local.migrating_services

  family                   = "${local.environment_name}-${each.key}-migration"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name      = "${each.key}-migration"
      image     = "${aws_ecr_repository.service[each.key].repository_url}:${var.image_tag}"
      essential = true
      cpu       = var.task_cpu
      memory    = var.task_memory
      user      = "node"
      command   = ["node", "dist/migrate.js"]
      environment = concat(
        [
          { name = "NODE_ENV", value = "production" },
          { name = "PORT", value = tostring(each.value.port) },
        ],
        [
          for name, value in local.task_environment[each.key] : {
            name  = name
            value = value
          }
        ],
      )
      secrets = [
        for name, value_from in local.task_secrets[each.key] : {
          name      = name
          valueFrom = value_from
        }
      ]
      readonlyRootFilesystem = true
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.service[each.key].name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "migration"
        }
      }
    }
  ])
}

# Runs the database roles and databases, and the default or demo account seed (see deploy/aws/ops/Dockerfile). Its command is
# given at run time with --overrides.
resource "aws_ecs_task_definition" "ops" {
  family                   = "${local.environment_name}-ops"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name                   = "ops"
      image                  = "${aws_ecr_repository.service["ops"].repository_url}:${var.image_tag}"
      essential              = true
      cpu                    = var.task_cpu
      memory                 = var.task_memory
      readonlyRootFilesystem = true
      environment = [
        { name = "PGHOST", value = aws_db_instance.this.address },
        { name = "PGSSLMODE", value = "require" },
        { name = "POSTGRES_USER", value = local.admin_user },
      ]
      secrets = [
        for name, value_from in local.ops_secret_arns : {
          name      = name
          valueFrom = value_from
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.service["ops"].name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ops"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "service" {
  for_each = var.services_enabled ? local.backend_services : {}

  name            = "${local.environment_name}-${each.key}"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.service[each.key].arn
  # Fixed count while autoscaling is off. While it is on, null leaves the count to the scalable target (autoscaling.tf).
  desired_count                     = var.autoscaling_enabled ? null : lookup(var.service_desired_count, each.key, var.desired_count)
  launch_type                       = "FARGATE"
  platform_version                  = "1.4.0"
  health_check_grace_period_seconds = 60
  # Stop-before-start: a rolling deploy never runs more tasks than desired_count, so it stays within the Fargate vCPU
  # quota. Each service has a brief outage while its single old task stops and the new one becomes healthy.
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100
  enable_ecs_managed_tags            = true
  propagate_tags                     = "SERVICE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = concat([aws_security_group.ecs_tasks.id], contains(local.embedder_client_services, each.key) ? aws_security_group.embedder_client[*].id : [])
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.service[each.key].arn
    container_name   = each.key
    container_port   = each.value.port
  }

  service_registries {
    registry_arn = aws_service_discovery_service.service[each.key].arn
  }

  depends_on = [aws_lb_listener_rule.service, aws_lb_listener_rule.search_products]
}

resource "aws_service_discovery_service" "embedder" {
  count = var.embedder_enabled ? 1 : 0

  name = local.embedder_name

  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.this.id
    dns_records {
      ttl  = 10
      type = "A"
    }
    routing_policy = "MULTIVALUE"
  }

  health_check_custom_config {
    failure_threshold = 1
  }
}

# Self-hosted product search embeddings, off by default. The model downloads on start (no volume on Fargate), so the
# container keeps a writable /tmp for the model cache.
resource "aws_ecs_task_definition" "embedder" {
  count = var.embedder_enabled ? 1 : 0

  family                   = "${local.environment_name}-${local.embedder_name}"
  cpu                      = local.embedder_task_cpu
  memory                   = local.embedder_task_memory
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name      = local.embedder_name
      image     = "ghcr.io/huggingface/text-embeddings-inference@sha256:2538ea1c9640d3763b15af668039d24172d063b42337b0c27796fc2be180c78d"
      essential = true
      cpu       = local.embedder_task_cpu
      memory    = local.embedder_task_memory
      user      = "10001"
      # The shell only expands API_KEY, which ECS injects from SSM, so the key never appears in Terraform
      # state or in this file. The :? guard stops the container if the secret is empty.
      entryPoint = ["/bin/sh", "-c"]
      command = [
        ": \"$${API_KEY:?API_KEY is not set}\"; exec text-embeddings-router --model-id ${local.embedder_model_id} --api-key \"$API_KEY\""
      ]
      environment = [{ name = "HUGGINGFACE_HUB_CACHE", value = "/tmp" }]
      portMappings = [{
        containerPort = local.embedder_port
        hostPort      = local.embedder_port
        protocol      = "tcp"
      }]
      secrets = [{
        name      = "API_KEY"
        valueFrom = local.secret_arn["shared/AI_EMBEDDING_API_KEY"]
      }]
      readonlyRootFilesystem = false
      healthCheck = {
        command     = ["CMD-SHELL", "curl -fsS http://127.0.0.1:${local.embedder_port}/health || exit 1"]
        interval    = 30
        timeout     = 10
        retries     = 3
        startPeriod = 300
      }
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.embedder[0].name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }
    }
  ])
}

# One task, deliberately, with no autoscaling. While the embedder is down, catalog search falls back to keywords.
resource "aws_ecs_service" "embedder" {
  count = var.services_enabled && var.embedder_enabled ? 1 : 0

  name                               = "${local.environment_name}-${local.embedder_name}"
  cluster                            = aws_ecs_cluster.this.id
  task_definition                    = aws_ecs_task_definition.embedder[0].arn
  desired_count                      = 1
  launch_type                        = "FARGATE"
  platform_version                   = "1.4.0"
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  enable_ecs_managed_tags            = true
  propagate_tags                     = "SERVICE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.embedder[0].id]
    assign_public_ip = false
  }

  service_registries {
    registry_arn = aws_service_discovery_service.embedder[0].arn
  }
}

# No CORS: the browsers call /api on the origin of their app, and that origin proxies it here, so no cross-origin
# request exists.
resource "aws_apigatewayv2_api" "public" {
  name          = "${local.environment_name}-public"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_vpc_link" "services" {
  name               = "${local.environment_name}-services"
  security_group_ids = [aws_security_group.vpc_link.id]
  subnet_ids         = aws_subnet.private[*].id
}

resource "aws_cloudwatch_log_group" "api_gateway_access_logs" {
  name              = "/aws/apigateway/${local.environment_name}-public"
  retention_in_days = var.log_retention_in_days
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.public.id
  name        = "$default"
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_gateway_access_logs.arn
    format = jsonencode({
      requestId               = "$context.requestId"
      ip                      = "$context.identity.sourceIp"
      requestTime             = "$context.requestTime"
      httpMethod              = "$context.httpMethod"
      routeKey                = "$context.routeKey"
      status                  = "$context.status"
      protocol                = "$context.protocol"
      responseLength          = "$context.responseLength"
      integrationErrorMessage = "$context.integrationErrorMessage"
      integrationLatency      = "$context.integration.latency"
      integrationStatus       = "$context.integration.status"
      userAgent               = "$context.identity.userAgent"
    })
  }

  default_route_settings {
    throttling_burst_limit = var.throttling_burst_limit
    throttling_rate_limit  = var.throttling_rate_limit
  }
}

resource "aws_apigatewayv2_integration" "services" {
  api_id                 = aws_apigatewayv2_api.public.id
  integration_type       = "HTTP_PROXY"
  integration_uri        = aws_lb_listener.internal.arn
  integration_method     = "ANY"
  connection_type        = "VPC_LINK"
  connection_id          = aws_apigatewayv2_vpc_link.services.id
  payload_format_version = "1.0"

  request_parameters = {
    "overwrite:path"                = "/$request.path.proxy"
    "overwrite:header.x-request-id" = "$context.requestId"
  }
}

resource "aws_apigatewayv2_route" "api" {
  api_id             = aws_apigatewayv2_api.public.id
  route_key          = "ANY /api/{proxy+}"
  target             = "integrations/${aws_apigatewayv2_integration.services.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_integration" "sepay_webhook" {
  api_id                 = aws_apigatewayv2_api.public.id
  integration_type       = "HTTP_PROXY"
  integration_uri        = aws_lb_listener.internal.arn
  integration_method     = "POST"
  connection_type        = "VPC_LINK"
  connection_id          = aws_apigatewayv2_vpc_link.services.id
  payload_format_version = "1.0"

  # API Gateway drops an empty-string override, so it cannot blank the identity headers here. payment-service removes
  # them itself (stripIdentityHeaders).
  request_parameters = {
    "overwrite:path"                = "/payments/sepay/webhook"
    "overwrite:header.x-request-id" = "$context.requestId"
  }
}

resource "aws_apigatewayv2_route" "sepay_webhook" {
  api_id             = aws_apigatewayv2_api.public.id
  route_key          = "POST /api/payments/sepay/webhook"
  target             = "integrations/${aws_apigatewayv2_integration.sepay_webhook.id}"
  authorization_type = "NONE"
}
