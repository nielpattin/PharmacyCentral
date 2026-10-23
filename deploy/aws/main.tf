locals {
  environment_name = "${var.project_name}-${var.environment}"

  backend_services = {
    identity-service = {
      port  = 3001
      image = var.images["identity-service"]
    }
    catalog-service = {
      port  = 3002
      image = var.images["catalog-service"]
    }
    inventory-service = {
      port  = 3004
      image = var.images["inventory-service"]
    }
    sales-service = {
      port  = 3005
      image = var.images["sales-service"]
    }
    payment-service = {
      port  = 3006
      image = var.images["payment-service"]
    }
    operations-query-service = {
      port  = 3007
      image = var.images["operations-query-service"]
    }
    chatbot-service = {
      port  = 3008
      image = var.images["chatbot-service"]
    }
    search-service = {
      port  = 3009
      image = var.images["search-service"]
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
      paths    = ["/sites*", "/storage-locations*", "/products*", "/suppliers*", "/pricing*", "/stores*", "/availability*"]
      service  = "catalog-service"
    }
    procurement = {
      priority = 30
      paths    = ["/procurement*"]
      service  = "inventory-service"
    }
    inventory-service = {
      priority = 40
      paths    = ["/inventory*", "/quality*"]
      service  = "inventory-service"
    }
    sales-service = {
      priority = 50
      paths    = ["/carts*", "/orders*", "/delivery*", "/prescriptions*", "/counter-transactions*"]
      service  = "sales-service"
    }
    payments = {
      priority = 60
      paths    = ["/payments*"]
      service  = "payment-service"
    }
    operations = {
      priority = 70
      paths    = ["/operations*", "/dashboard*", "/finance*", "/audit*", "/reports*"]
      service  = "operations-query-service"
    }
    chatbot = {
      priority = 80
      paths    = ["/chatbot*"]
      service  = "chatbot-service"
    }
  }

  authorizer_secret_env = merge(
    { for k in ["INTERNAL_IDENTITY_SECRET", "INTERNAL_SERVICE_SECRET"] : k => var.shared_secrets[k] if contains(keys(var.shared_secrets), k) },
    var.authorizer_secrets
  )

  service_secret_arns = distinct(compact(concat(
    values(var.shared_secrets),
    flatten([for s in values(var.service_secrets) : values(s)])
  )))

  execution_secret_arns = distinct(compact(concat(
    local.service_secret_arns,
    [var.embedder_api_key_secret_arn],
    var.repository_credentials_secret_arn != null && var.repository_credentials_secret_arn != "" ? [var.repository_credentials_secret_arn] : []
  )))

  authorizer_secret_arns = distinct(compact(concat(
    values(local.authorizer_secret_env),
    values(var.authorizer_secrets)
  )))

  embedder_name     = "embedder"
  embedder_port     = 80
  embedder_model_id = "intfloat/multilingual-e5-small"
  embedder_url      = "http://${aws_service_discovery_service.embedder.name}.${aws_service_discovery_private_dns_namespace.this.name}:${local.embedder_port}/v1"

  # Keys are Fargate CPU units; values are [min, max] task memory in MiB.
  fargate_memory_bounds = {
    "1024" = [2048, 8192]
    "2048" = [4096, 16384]
    "4096" = [8192, 30720]
  }

  embedder_clients = ["catalog-service", "search-service"]

  # The clients' four AI_EMBEDDING_* settings are set together here, and the key is the secret the embedder reads, so
  # the two sides cannot drift apart.
  embedder_client_environment = {
    AI_EMBEDDING_PROVIDER = "openai-compatible"
    AI_EMBEDDING_BASE_URL = local.embedder_url
    AI_EMBEDDING_MODEL    = local.embedder_model_id
  }
  embedder_client_secrets = {
    AI_EMBEDDING_API_KEY = var.embedder_api_key_secret_arn
  }

  # search-service is a Go binary: no node entrypoint, no Drizzle migration, and its own health endpoint.
  go_services = ["search-service"]

  # Services that need more than the shared task size. sales-service writes every order and runs its outbox relay
  # in the same process; at 0.5 vCPU it was the first container to hit its CPU cap under the checkout load test.
  task_sizes = {
    sales-service = { cpu = var.sales_task_cpu, memory = var.sales_task_memory }
  }
  health_check_paths = {
    search-service = "/healthz"
  }
  migrating_services = { for name, service in local.backend_services : name => service if !contains(local.go_services, name) }

  # Container environment and secrets per backend service. The service and the migration task definitions both use these.
  task_environment = {
    for name in keys(local.backend_services) :
    name => merge(
      lookup(var.service_environment, name, {}),
      contains(local.embedder_clients, name) ? local.embedder_client_environment : {}
    )
  }
  task_secrets = {
    for name in keys(local.backend_services) :
    name => merge(
      var.shared_secrets,
      lookup(var.service_secrets, name, {}),
      contains(local.embedder_clients, name) ? local.embedder_client_secrets : {}
    )
  }
}

resource "aws_security_group" "vpc_link" {
  name        = "${local.environment_name}-vpc-link"
  description = "Security group for API Gateway HTTP API VPC link"
  vpc_id      = var.vpc_id

  tags = {
    Name = "${local.environment_name}-vpc-link"
  }
}

resource "aws_security_group" "alb" {
  name        = "${local.environment_name}-alb"
  description = "Security group for internal Application Load Balancer"
  vpc_id      = var.vpc_id

  tags = {
    Name = "${local.environment_name}-alb"
  }
}

resource "aws_security_group" "ecs_tasks" {
  name        = "${local.environment_name}-ecs-tasks"
  description = "Security group for backend ECS Fargate tasks"
  vpc_id      = var.vpc_id

  tags = {
    Name = "${local.environment_name}-ecs-tasks"
  }
}

resource "aws_security_group" "lambda" {
  name        = "${local.environment_name}-authorizer-lambda"
  description = "Security group for authorizer Lambda in private VPC subnets"
  vpc_id      = var.vpc_id

  tags = {
    Name = "${local.environment_name}-authorizer-lambda"
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

resource "aws_security_group_rule" "alb_ingress_lambda" {
  type                     = "ingress"
  description              = "Allow inbound HTTP traffic from Authorizer Lambda"
  from_port                = 80
  to_port                  = 80
  protocol                 = "tcp"
  security_group_id        = aws_security_group.alb.id
  source_security_group_id = aws_security_group.lambda.id
}

resource "aws_security_group_rule" "alb_egress_tasks" {
  type                     = "egress"
  description              = "Allow outbound HTTP traffic from ALB to backend ECS tasks"
  from_port                = 3001
  to_port                  = 3009
  protocol                 = "tcp"
  security_group_id        = aws_security_group.alb.id
  source_security_group_id = aws_security_group.ecs_tasks.id
}

resource "aws_security_group_rule" "tasks_ingress_alb" {
  type                     = "ingress"
  description              = "Allow inbound traffic from internal ALB on backend service ports"
  from_port                = 3001
  to_port                  = 3009
  protocol                 = "tcp"
  security_group_id        = aws_security_group.ecs_tasks.id
  source_security_group_id = aws_security_group.alb.id
}

resource "aws_security_group_rule" "tasks_ingress_self" {
  type              = "ingress"
  description       = "Allow service-to-service Cloud Map communication between ECS tasks"
  from_port         = 3001
  to_port           = 3009
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

resource "aws_security_group_rule" "lambda_egress_all" {
  type              = "egress"
  description       = "Allow outbound traffic for internal ALB calls and NAT/AWS service access"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  security_group_id = aws_security_group.lambda.id
  cidr_blocks       = ["0.0.0.0/0"]
}

resource "aws_security_group" "embedder" {
  name        = "${local.environment_name}-embedder"
  description = "Security group for the embedder ECS Fargate task"
  vpc_id      = var.vpc_id

  tags = {
    Name = "${local.environment_name}-embedder"
  }
}

# Attached to the catalog-service and search-service tasks only. The embedder group allows traffic from this group, not
# from the shared ECS tasks group, so no other backend service can reach the embedder.
resource "aws_security_group" "embedder_client" {
  name        = "${local.environment_name}-embedder-client"
  description = "Attached to catalog-service and search-service ECS tasks, the only clients allowed to reach the embedder"
  vpc_id      = var.vpc_id

  tags = {
    Name = "${local.environment_name}-embedder-client"
  }
}

resource "aws_security_group_rule" "embedder_ingress_clients" {
  type                     = "ingress"
  description              = "Allow inbound HTTP on port 80 from catalog-service and search-service tasks only"
  from_port                = 80
  to_port                  = 80
  protocol                 = "tcp"
  security_group_id        = aws_security_group.embedder.id
  source_security_group_id = aws_security_group.embedder_client.id
}

resource "aws_security_group_rule" "embedder_egress_all" {
  type              = "egress"
  description       = "Allow outbound traffic for ECR image pulls, CloudWatch Logs, Secrets Manager, and NAT gateway"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  security_group_id = aws_security_group.embedder.id
  cidr_blocks       = ["0.0.0.0/0"]
}

resource "aws_ecs_cluster" "this" {
  name = local.environment_name

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_cloudwatch_log_group" "service" {
  for_each          = local.backend_services
  name              = "/ecs/${local.environment_name}/${each.key}"
  retention_in_days = var.log_retention_in_days
}

resource "aws_cloudwatch_log_group" "embedder" {
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
  count       = length(local.execution_secret_arns) > 0 ? 1 : 0
  name        = "${local.environment_name}-ecs-execution-secrets"
  description = "Allow ECS task execution role to read configured Secrets Manager secrets and optional repository credentials"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = local.execution_secret_arns
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "task_execution_secrets" {
  count      = length(local.execution_secret_arns) > 0 ? 1 : 0
  role       = aws_iam_role.task_execution.name
  policy_arn = aws_iam_policy.task_execution_secrets[0].arn
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
  subnets            = var.private_subnet_ids
}

resource "aws_lb_target_group" "service" {
  for_each = local.backend_services

  name        = substr("${local.environment_name}-${replace(each.key, "_", "-")}", 0, 32)
  port        = each.value.port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id

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
  name = "${var.environment}.pharmacy.internal"
  vpc  = var.vpc_id
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

resource "aws_service_discovery_service" "embedder" {
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

resource "aws_ecs_task_definition" "service" {
  for_each = local.backend_services

  family                   = "${local.environment_name}-${each.key}"
  cpu                      = try(local.task_sizes[each.key].cpu, var.task_cpu)
  memory                   = try(local.task_sizes[each.key].memory, var.task_memory)
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
        image     = each.value.image
        essential = true
        cpu       = try(local.task_sizes[each.key].cpu, var.task_cpu)
        memory    = try(local.task_sizes[each.key].memory, var.task_memory)
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
      var.repository_credentials_secret_arn != null && var.repository_credentials_secret_arn != "" ? {
        repositoryCredentials = {
          credentialsParameter = var.repository_credentials_secret_arn
        }
      } : {}
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
    merge(
      {
        name      = "${each.key}-migration"
        image     = each.value.image
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
      },
      var.repository_credentials_secret_arn != null && var.repository_credentials_secret_arn != "" ? {
        repositoryCredentials = {
          credentialsParameter = var.repository_credentials_secret_arn
        }
      } : {}
    )
  ])
}

resource "aws_ecs_service" "service" {
  for_each = var.services_enabled ? local.backend_services : {}

  name                               = "${local.environment_name}-${each.key}"
  cluster                            = aws_ecs_cluster.this.id
  task_definition                    = aws_ecs_task_definition.service[each.key].arn
  desired_count                      = var.desired_count
  launch_type                        = "FARGATE"
  platform_version                   = "1.4.0"
  health_check_grace_period_seconds  = 60
  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200
  enable_ecs_managed_tags            = true
  propagate_tags                     = "SERVICE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = contains(local.embedder_clients, each.key) ? [aws_security_group.ecs_tasks.id, aws_security_group.embedder_client.id] : [aws_security_group.ecs_tasks.id]
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

  lifecycle {
    ignore_changes = [desired_count]
  }

  depends_on = [aws_lb_listener_rule.service, aws_lb_listener_rule.search_products]
}

resource "aws_appautoscaling_target" "service" {
  for_each = var.services_enabled ? local.backend_services : {}

  max_capacity       = var.max_count
  min_capacity       = var.desired_count
  resource_id        = "service/${aws_ecs_cluster.this.name}/${aws_ecs_service.service[each.key].name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "service_cpu" {
  for_each = var.services_enabled ? local.backend_services : {}

  name               = "${local.environment_name}-${each.key}-cpu-autoscaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.service[each.key].resource_id
  scalable_dimension = aws_appautoscaling_target.service[each.key].scalable_dimension
  service_namespace  = aws_appautoscaling_target.service[each.key].service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = var.autoscaling_cpu_target_value
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

resource "aws_appautoscaling_policy" "service_memory" {
  for_each = var.services_enabled ? local.backend_services : {}

  name               = "${local.environment_name}-${each.key}-memory-autoscaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.service[each.key].resource_id
  scalable_dimension = aws_appautoscaling_target.service[each.key].scalable_dimension
  service_namespace  = aws_appautoscaling_target.service[each.key].service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageMemoryUtilization"
    }
    target_value       = var.autoscaling_memory_target_value
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

resource "aws_ecs_task_definition" "embedder" {
  family                   = "${local.environment_name}-${local.embedder_name}"
  cpu                      = var.embedder_task_cpu
  memory                   = var.embedder_task_memory
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  lifecycle {
    precondition {
      condition = (
        var.embedder_task_memory % 1024 == 0 &&
        var.embedder_task_memory >= local.fargate_memory_bounds[tostring(var.embedder_task_cpu)][0] &&
        var.embedder_task_memory <= local.fargate_memory_bounds[tostring(var.embedder_task_cpu)][1]
      )
      error_message = "embedder_task_memory is not a valid Fargate memory size for embedder_task_cpu."
    }
  }

  container_definitions = jsonencode([
    merge(
      {
        name      = local.embedder_name
        image     = var.embedder_image
        essential = true
        cpu       = var.embedder_task_cpu
        memory    = var.embedder_task_memory
        user      = "10001"
        # The image's entrypoint is text-embeddings-router. The shell only expands API_KEY, which ECS injects from
        # Secrets Manager, so the key never appears in Terraform state or in this file. The :? guard stops the container
        # if the secret is empty.
        entryPoint = ["/bin/sh", "-c"]
        command = [
          ": \"$${API_KEY:?API_KEY is not set}\"; exec text-embeddings-router --model-id ${local.embedder_model_id} --api-key \"$API_KEY\""
        ]
        portMappings = [{
          containerPort = local.embedder_port
          hostPort      = local.embedder_port
          protocol      = "tcp"
        }]
        secrets = [{
          name      = "API_KEY"
          valueFrom = var.embedder_api_key_secret_arn
        }]
        readonlyRootFilesystem = true
        healthCheck = {
          command  = ["CMD-SHELL", "curl -fsS http://127.0.0.1:${local.embedder_port}/health || exit 1"]
          interval = 30
          timeout  = 10
          retries  = 3
          # Loading the ONNX model takes minutes on 2 vCPU. Failures inside this window do not count against the task.
          startPeriod = 300
        }
        logConfiguration = {
          logDriver = "awslogs"
          options = {
            "awslogs-group"         = aws_cloudwatch_log_group.embedder.name
            "awslogs-region"        = var.aws_region
            "awslogs-stream-prefix" = "ecs"
          }
        }
      },
      var.repository_credentials_secret_arn != null && var.repository_credentials_secret_arn != "" ? {
        repositoryCredentials = {
          credentialsParameter = var.repository_credentials_secret_arn
        }
      } : {}
    )
  ])
}

# One task, deliberately, with no autoscaling. While the embedder is down, catalog search falls back to keywords, so a
# second replica buys little. Deployments start the new task before stopping the old one, so search keeps its
# embeddings through a release.
resource "aws_ecs_service" "embedder" {
  count = var.services_enabled ? 1 : 0

  name                               = "${local.environment_name}-${local.embedder_name}"
  cluster                            = aws_ecs_cluster.this.id
  task_definition                    = aws_ecs_task_definition.embedder.arn
  desired_count                      = 1
  launch_type                        = "FARGATE"
  platform_version                   = "1.4.0"
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  enable_ecs_managed_tags            = true
  propagate_tags                     = "SERVICE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.embedder.id]
    assign_public_ip = false
  }

  service_registries {
    registry_arn = aws_service_discovery_service.embedder.arn
  }
}

data "archive_file" "lambda_package" {
  type        = "zip"
  source_dir  = "${path.module}/lambda"
  output_path = "${path.module}/.terraform/lambda_package.zip"
  excludes = [
    "tests",
    "tests/**",
  ]
}

resource "aws_iam_role" "authorizer" {
  name = "${local.environment_name}-authorizer-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "authorizer_vpc" {
  role       = aws_iam_role.authorizer.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_policy" "authorizer_secrets" {
  count       = length(local.authorizer_secret_arns) > 0 ? 1 : 0
  name        = "${local.environment_name}-authorizer-secrets"
  description = "Allow authorizer Lambda to read Secrets Manager secrets"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = local.authorizer_secret_arns
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "authorizer_secrets" {
  count      = length(local.authorizer_secret_arns) > 0 ? 1 : 0
  role       = aws_iam_role.authorizer.name
  policy_arn = aws_iam_policy.authorizer_secrets[0].arn
}

resource "aws_iam_role" "csrf" {
  name = "${local.environment_name}-csrf-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "csrf_basic" {
  role       = aws_iam_role.csrf.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_cloudwatch_log_group" "authorizer" {
  name              = "/aws/lambda/${local.environment_name}-authorizer"
  retention_in_days = var.log_retention_in_days
}

resource "aws_lambda_function" "authorizer" {
  filename         = data.archive_file.lambda_package.output_path
  source_code_hash = data.archive_file.lambda_package.output_base64sha256
  function_name    = "${local.environment_name}-authorizer"
  role             = aws_iam_role.authorizer.arn
  handler          = "index.authorizerHandler"
  runtime          = "nodejs22.x"
  timeout          = 10
  memory_size      = 256

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = merge(
      {
        NODE_ENV             = "production"
        IDENTITY_SERVICE_URL = "http://${aws_lb.internal.dns_name}"
      },
      var.authorizer_environment,
      local.authorizer_secret_env
    )
  }

  depends_on = [
    aws_iam_role_policy_attachment.authorizer_vpc,
    aws_cloudwatch_log_group.authorizer,
  ]
}

resource "aws_cloudwatch_log_group" "csrf" {
  name              = "/aws/lambda/${local.environment_name}-csrf"
  retention_in_days = var.log_retention_in_days
}

resource "aws_lambda_function" "csrf" {
  filename         = data.archive_file.lambda_package.output_path
  source_code_hash = data.archive_file.lambda_package.output_base64sha256
  function_name    = "${local.environment_name}-csrf"
  role             = aws_iam_role.csrf.arn
  handler          = "index.csrfHandler"
  runtime          = "nodejs22.x"
  timeout          = 5
  memory_size      = 128

  environment {
    variables = {
      NODE_ENV = "production"
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.csrf_basic,
    aws_cloudwatch_log_group.csrf,
  ]
}

resource "aws_apigatewayv2_api" "public" {
  name          = "${local.environment_name}-public"
  protocol_type = "HTTP"

  cors_configuration {
    allow_credentials = true
    allow_headers     = ["content-type", "cookie", "idempotency-key", "x-csrf-token", "x-guest-cart-token", "x-request-id"]
    allow_methods     = ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"]
    allow_origins     = var.allowed_origins
    max_age           = 3600
  }
}

resource "aws_apigatewayv2_vpc_link" "services" {
  name               = "${local.environment_name}-services"
  security_group_ids = [aws_security_group.vpc_link.id]
  subnet_ids         = var.api_gateway_subnet_ids
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
      authorizerError         = "$context.authorizer.error"
      authorizerStatus        = "$context.authorizer.status"
      authorizerLatency       = "$context.authorizer.latency"
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

resource "aws_apigatewayv2_authorizer" "request" {
  api_id                            = aws_apigatewayv2_api.public.id
  authorizer_type                   = "REQUEST"
  authorizer_uri                    = aws_lambda_function.authorizer.invoke_arn
  authorizer_payload_format_version = "2.0"
  enable_simple_responses           = true
  name                              = "${local.environment_name}-request-authorizer"
  authorizer_result_ttl_in_seconds  = 0
}

resource "aws_lambda_permission" "authorizer" {
  statement_id  = "AllowApiGatewayInvokeAuthorizer"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.authorizer.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.public.execution_arn}/authorizers/${aws_apigatewayv2_authorizer.request.id}"
}

resource "aws_lambda_permission" "csrf" {
  statement_id  = "AllowApiGatewayInvokeCsrf"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.csrf.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.public.execution_arn}/*/*/api/auth/csrf"
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
    "overwrite:path"                               = "/$request.path.proxy"
    "overwrite:header.x-internal-identity-context" = "$context.authorizer.signedIdentityContext"
    "overwrite:header.x-actor-id"                  = "$context.authorizer.actorId"
    "overwrite:header.x-actor-type"                = "$context.authorizer.actorType"
    "overwrite:header.x-request-id"                = "$context.requestId"
  }
}

resource "aws_apigatewayv2_route" "api" {
  api_id             = aws_apigatewayv2_api.public.id
  route_key          = "ANY /api/{proxy+}"
  target             = "integrations/${aws_apigatewayv2_integration.services.id}"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.request.id
}

resource "aws_apigatewayv2_integration" "csrf" {
  api_id                 = aws_apigatewayv2_api.public.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.csrf.invoke_arn
  integration_method     = "POST"
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "csrf" {
  api_id             = aws_apigatewayv2_api.public.id
  route_key          = "GET /api/auth/csrf"
  target             = "integrations/${aws_apigatewayv2_integration.csrf.id}"
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
