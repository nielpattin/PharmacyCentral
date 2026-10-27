locals {
  rabbitmq_user = "pharmacy_mq"
  rabbitmq_host = "rabbitmq.${local.namespace}"
  admin_user    = "pharmacy_admin"

  # Each database has a role of the same name that owns only that database (deploy/local/postgres/roles.sh). The role's
  # password variable is <PREFIX>_DB_PASSWORD, where PREFIX is the database name without its _service suffix.
  databases = {
    identity-service         = "identity_service"
    catalog-service          = "catalog_service"
    inventory-service        = "inventory_service"
    sales-service            = "sales_service"
    payment-service          = "payment_service"
    operations-query-service = "operations_query_service"
    chatbot-service          = "chatbot_service"
  }

  # Values TFCore generates, keyed "<scope>/<NAME>". Scope is "shared" for one secret many services read, a service name
  # for a secret only that service reads, or "ops" for the ops task. Secrets Manager names are <environment>/<key>, parameter names /<environment>/<key>.
  generated_secret_values = merge(
    {
      "shared/RABBITMQ_URL"                 = "amqp://${local.rabbitmq_user}:${random_password.rabbitmq.result}@${local.rabbitmq_host}:5672/"
      "shared/REDIS_URL"                    = "redis://${aws_elasticache_cluster.this.cache_nodes[0].address}:6379"
      "shared/INTERNAL_IDENTITY_SECRET"     = random_password.internal_identity_secret.result
      "shared/INTERNAL_SERVICE_SECRET"      = random_password.internal_service_secret.result
      "shared/SECRETS_ENCRYPTION_KEY"       = random_bytes.secrets_encryption_key.base64
      "shared/TYPESENSE_URL"                = "http://typesense.${local.namespace}:8108"
      "shared/TYPESENSE_API_KEY"            = random_password.typesense_api_key.result
      "shared/RABBITMQ_MANAGEMENT_URL"      = "http://${local.rabbitmq_host}:15672"
      "shared/RABBITMQ_MANAGEMENT_USER"     = local.rabbitmq_user
      "shared/RABBITMQ_MANAGEMENT_PASSWORD" = random_password.rabbitmq.result
      "shared/AI_EMBEDDING_API_KEY"         = random_password.embedder_api_key.result
      "ops/PGPASSWORD"                      = random_password.postgres_admin.result
      "ops/DATABASE_URL"                    = "postgresql://${local.admin_user}:${random_password.postgres_admin.result}@${aws_db_instance.this.address}:5432/postgres?sslmode=no-verify"
    },
    { for service, db in local.databases : "${service}/DATABASE_URL" => "postgresql://${db}:${random_password.database[service].result}@${aws_db_instance.this.address}:5432/${db}?sslmode=no-verify" },
    { for service, db in local.databases : "ops/${upper(replace(db, "_service", ""))}_DB_PASSWORD" => random_password.database[service].result },
  )

  # Values the operator supplies through demo.auto.tfvars.json, keyed by scope the same way.
  supplied_secret_values = merge(var.service_secret_values, tomap({ ops = var.ops_secret_values }))
  supplied_secret_keys = nonsensitive(toset(flatten([
    for scope, values in local.supplied_secret_values : [for name in keys(values) : "${scope}/${name}"]
  ])))

  secret_values = merge(
    local.generated_secret_values,
    { for key in local.supplied_secret_keys : key => local.supplied_secret_values[split("/", key)[0]][split("/", key)[1]] },
  )

  # The authorizer Lambda reads these two through the Secrets Manager SDK. Everything else is a SecureString parameter,
  # which costs nothing, where a Secrets Manager secret costs 0.40 USD a month each. ECS reads both kinds by ARN.
  lambda_secret_keys = ["shared/INTERNAL_IDENTITY_SECRET", "shared/INTERNAL_SERVICE_SECRET"]
  parameter_keys     = nonsensitive(toset([for key in keys(local.secret_values) : key if !contains(local.lambda_secret_keys, key)]))

  secret_arn = merge(
    { for key, secret in aws_secretsmanager_secret.this : key => secret.arn },
    { for key, parameter in aws_ssm_parameter.this : key => parameter.arn },
  )

  # Secrets each backend service reads as environment variables, besides its own DATABASE_URL and supplied values.
  shared_secret_names = ["RABBITMQ_URL", "REDIS_URL", "INTERNAL_IDENTITY_SECRET", "INTERNAL_SERVICE_SECRET"]
  service_shared_secret_names = {
    catalog-service     = ["SECRETS_ENCRYPTION_KEY", "TYPESENSE_URL", "TYPESENSE_API_KEY"]
    sales-service       = ["SECRETS_ENCRYPTION_KEY"]
    chatbot-service     = ["SECRETS_ENCRYPTION_KEY"]
    search-service      = ["TYPESENSE_URL", "TYPESENSE_API_KEY"]
    ops-console-service = ["TYPESENSE_URL", "TYPESENSE_API_KEY", "RABBITMQ_MANAGEMENT_URL", "RABBITMQ_MANAGEMENT_USER", "RABBITMQ_MANAGEMENT_PASSWORD"]
  }

  service_secret_arns = {
    for name in keys(local.backend_services) : name => merge(
      { for secret in concat(local.shared_secret_names, lookup(local.service_shared_secret_names, name, [])) : secret => local.secret_arn["shared/${secret}"] },
      contains(keys(local.databases), name) ? { DATABASE_URL = local.secret_arn["${name}/DATABASE_URL"] } : {},
      { for secret in nonsensitive(keys(lookup(var.service_secret_values, name, {}))) : secret => local.secret_arn["${name}/${secret}"] },
      lookup(local.web_service_secrets, name, {}),
    )
  }

  ops_secret_arns = { for key, arn in local.secret_arn : split("/", key)[1] => arn if startswith(key, "ops/") }

  # The authorizer Lambda reads these two secrets itself, so it gets their ARNs.
  authorizer_secret_env = {
    INTERNAL_IDENTITY_SECRET = local.secret_arn["shared/INTERNAL_IDENTITY_SECRET"]
    INTERNAL_SERVICE_SECRET  = local.secret_arn["shared/INTERNAL_SERVICE_SECRET"]
  }
}

resource "random_password" "postgres_admin" {
  length  = 32
  special = false
}

resource "random_password" "database" {
  for_each = local.databases

  length  = 32
  special = false
}

resource "random_password" "rabbitmq" {
  length  = 32
  special = false
}

resource "random_password" "typesense_api_key" {
  length  = 32
  special = false
}

resource "random_password" "internal_identity_secret" {
  length  = 64
  special = false
}

resource "random_password" "internal_service_secret" {
  length  = 64
  special = false
}

resource "random_password" "embedder_api_key" {
  length  = 32
  special = false
}

# 32 random bytes; the base64 form is the padded text that secret-box expects.
resource "random_bytes" "secrets_encryption_key" {
  length = 32
}

resource "aws_secretsmanager_secret" "this" {
  for_each = toset(local.lambda_secret_keys)

  name                    = "${local.environment_name}/${each.key}"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "this" {
  for_each = aws_secretsmanager_secret.this

  secret_id     = each.value.id
  secret_string = local.secret_values[each.key]
}

resource "aws_ssm_parameter" "this" {
  for_each = local.parameter_keys

  name  = "/${local.environment_name}/${each.key}"
  type  = "SecureString"
  value = local.secret_values[each.key]
}

resource "aws_security_group" "database" {
  name        = "${local.environment_name}-database"
  description = "RDS PostgreSQL, reachable from backend ECS tasks only"
  vpc_id      = aws_vpc.this.id

  ingress {
    description     = "PostgreSQL from backend ECS tasks"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
  }
}

resource "aws_security_group" "cache" {
  name        = "${local.environment_name}-cache"
  description = "ElastiCache Redis, reachable from backend ECS tasks only"
  vpc_id      = aws_vpc.this.id

  ingress {
    description     = "Redis from backend ECS tasks"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
  }
}

resource "aws_db_subnet_group" "this" {
  name       = local.environment_name
  subnet_ids = aws_subnet.private[*].id
}

# db_name creates identity_service. The other six databases come from deploy/local/postgres/init/001-create-databases.sql,
# run by the ops task, because RDS creates only one database at launch.
resource "aws_db_instance" "this" {
  identifier             = local.environment_name
  engine                 = "postgres"
  engine_version         = "18.6"
  instance_class         = "db.t4g.micro"
  allocated_storage      = 20
  storage_type           = "gp3"
  db_name                = "identity_service"
  username               = local.admin_user
  password               = random_password.postgres_admin.result
  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.database.id]
  publicly_accessible    = false
  multi_az               = false
  skip_final_snapshot    = true
  apply_immediately      = true
}

resource "aws_elasticache_subnet_group" "this" {
  name       = local.environment_name
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_elasticache_cluster" "this" {
  cluster_id           = local.environment_name
  engine               = "redis"
  engine_version       = "7.1"
  node_type            = "cache.t4g.micro"
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
  port                 = 6379
  subnet_group_name    = aws_elasticache_subnet_group.this.name
  security_group_ids   = [aws_security_group.cache.id]
}

# RabbitMQ runs as a Fargate task: Amazon MQ offers no RabbitMQ 4 broker below mq.m7g.medium, which costs about 100 USD a month.
# The queues live on ephemeral task storage. The services declare their queues when they connect, and a restart loses
# only the events that were queued but not yet consumed. On-demand capacity, not Spot, so it is not interrupted.
resource "aws_service_discovery_service" "rabbitmq" {
  name = "rabbitmq"

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

resource "aws_ecs_task_definition" "rabbitmq" {
  family                   = "${local.environment_name}-rabbitmq"
  cpu                      = 512
  memory                   = 1024
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name      = "rabbitmq"
    image     = "rabbitmq:4.3.5-management@sha256:397fde82bc04522d88680b57cbf5d70caae715a76c957404e52e3f0fa056b8f3"
    essential = true
    cpu       = 512
    memory    = 1024
    portMappings = [
      { containerPort = 5672, hostPort = 5672, protocol = "tcp" },
      { containerPort = 15672, hostPort = 15672, protocol = "tcp" },
    ]
    environment = [{ name = "RABBITMQ_DEFAULT_USER", value = local.rabbitmq_user }]
    secrets = [{
      name      = "RABBITMQ_DEFAULT_PASS"
      valueFrom = local.secret_arn["shared/RABBITMQ_MANAGEMENT_PASSWORD"]
    }]
    healthCheck = {
      command  = ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval = 30
      timeout  = 10
      retries  = 5
    }
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.service["rabbitmq"].name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "ecs"
      }
    }
  }])
}

resource "aws_ecs_service" "rabbitmq" {
  name                               = "${local.environment_name}-rabbitmq"
  cluster                            = aws_ecs_cluster.this.id
  task_definition                    = aws_ecs_task_definition.rabbitmq.arn
  desired_count                      = 1
  launch_type                        = "FARGATE"
  platform_version                   = "1.4.0"
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100
  enable_ecs_managed_tags            = true
  propagate_tags                     = "SERVICE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }

  service_registries {
    registry_arn = aws_service_discovery_service.rabbitmq.arn
  }
}

resource "aws_service_discovery_service" "typesense" {
  name = "typesense"

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

# Typesense keeps its index on ephemeral task storage. catalog-service rebuilds it from PostgreSQL when it is empty.
resource "aws_ecs_task_definition" "typesense" {
  family                   = "${local.environment_name}-typesense"
  cpu                      = 256
  memory                   = 512
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  # The image has no /data directory, so an empty task volume provides it. The index is a derived copy: catalog-service
  # rebuilds it.
  volume {
    name = "data"
  }

  container_definitions = jsonencode([{
    name      = "typesense"
    image     = "typesense/typesense@sha256:610f2d34b1f93d00762869da2c67736775e5798d19a2c8b91b014b8a0cc1e110"
    essential = true
    cpu       = 256
    memory    = 512
    portMappings = [{
      containerPort = 8108
      hostPort      = 8108
      protocol      = "tcp"
    }]
    mountPoints = [{ sourceVolume = "data", containerPath = "/data" }]
    environment = [{ name = "TYPESENSE_DATA_DIR", value = "/data" }]
    secrets = [{
      name      = "TYPESENSE_API_KEY"
      valueFrom = local.secret_arn["shared/TYPESENSE_API_KEY"]
    }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.service["typesense"].name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "ecs"
      }
    }
  }])
}

resource "aws_ecs_service" "typesense" {
  name                               = "${local.environment_name}-typesense"
  cluster                            = aws_ecs_cluster.this.id
  task_definition                    = aws_ecs_task_definition.typesense.arn
  desired_count                      = 1
  launch_type                        = "FARGATE"
  platform_version                   = "1.4.0"
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100
  enable_ecs_managed_tags            = true
  propagate_tags                     = "SERVICE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }

  service_registries {
    registry_arn = aws_service_discovery_service.typesense.arn
  }
}
