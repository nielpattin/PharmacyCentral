# Off by default (otel_collector_enabled). When on, it receives the OTLP that every backend service pushes and forwards it to
# AWS: metrics to Amazon Managed Service for Prometheus, traces to X-Ray, logs to CloudWatch Logs. Services find it at
# otel-collector.<environment>.pharmacy.internal:4318 (their OTEL_EXPORTER_OTLP_ENDPOINT). Its config is
# deploy/aws/otel/collector.yaml, passed in AOT_CONFIG_CONTENT.
locals {
  otel_collector_name  = "otel-collector"
  otel_collector_port  = 4318
  otel_collector_image = "public.ecr.aws/aws-observability/aws-otel-collector@sha256:7968fb60db6a2390a47ba6a2df029745638486e285c9b2487da1b722d0855a3e"
}

resource "aws_prometheus_workspace" "this" {
  count = var.otel_collector_enabled ? 1 : 0

  alias = local.environment_name
}

resource "aws_cloudwatch_log_group" "otel_collector" {
  count = var.otel_collector_enabled ? 1 : 0

  name              = "/ecs/${local.environment_name}/${local.otel_collector_name}"
  retention_in_days = var.log_retention_in_days
}

# The application logs the collector exports, one stream per collector task.
resource "aws_cloudwatch_log_group" "otel_logs" {
  count = var.otel_collector_enabled ? 1 : 0

  name              = "/otel/${local.environment_name}/logs"
  retention_in_days = var.log_retention_in_days
}

resource "aws_security_group" "otel_collector" {
  count = var.otel_collector_enabled ? 1 : 0

  name        = "${local.environment_name}-otel-collector"
  description = "Security group for the OpenTelemetry collector ECS Fargate task"
  vpc_id      = aws_vpc.this.id

  tags = {
    Name = "${local.environment_name}-otel-collector"
  }
}

resource "aws_security_group_rule" "otel_collector_ingress_tasks" {
  count = var.otel_collector_enabled ? 1 : 0

  type                     = "ingress"
  description              = "Allow OTLP over HTTP from the backend service tasks"
  from_port                = local.otel_collector_port
  to_port                  = local.otel_collector_port
  protocol                 = "tcp"
  security_group_id        = aws_security_group.otel_collector[0].id
  source_security_group_id = aws_security_group.ecs_tasks.id
}

resource "aws_security_group_rule" "otel_collector_egress_all" {
  count = var.otel_collector_enabled ? 1 : 0

  type              = "egress"
  description       = "Allow outbound traffic to AWS APIs for ECR image pulls, Managed Prometheus, X-Ray and CloudWatch Logs"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  security_group_id = aws_security_group.otel_collector[0].id
  cidr_blocks       = ["0.0.0.0/0"]
}

resource "aws_iam_role" "otel_collector" {
  count = var.otel_collector_enabled ? 1 : 0

  name = "${local.environment_name}-otel-collector"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_policy" "otel_collector" {
  count = var.otel_collector_enabled ? 1 : 0

  name = "${local.environment_name}-otel-collector"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "WriteMetrics"
        Effect   = "Allow"
        Action   = ["aps:RemoteWrite"]
        Resource = aws_prometheus_workspace.this[0].arn
      },
      {
        Sid    = "WriteTraces"
        Effect = "Allow"
        Action = [
          "xray:PutTraceSegments",
          "xray:PutTelemetryRecords",
          "xray:GetSamplingRules",
          "xray:GetSamplingTargets",
          "xray:GetSamplingStatisticsSummaries",
        ]
        Resource = "*"
      },
      {
        Sid      = "WriteLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"]
        Resource = "${aws_cloudwatch_log_group.otel_logs[0].arn}:*"
      },
    ]
  })
}

resource "aws_iam_role_policy_attachment" "otel_collector" {
  count = var.otel_collector_enabled ? 1 : 0

  role       = aws_iam_role.otel_collector[0].name
  policy_arn = aws_iam_policy.otel_collector[0].arn
}

resource "aws_service_discovery_service" "otel_collector" {
  count = var.otel_collector_enabled ? 1 : 0

  name = local.otel_collector_name

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

resource "aws_ecs_task_definition" "otel_collector" {
  count = var.otel_collector_enabled ? 1 : 0

  family                   = "${local.environment_name}-${local.otel_collector_name}"
  cpu                      = 512
  memory                   = 1024
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.otel_collector[0].arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name      = local.otel_collector_name
      image     = local.otel_collector_image
      essential = true
      cpu       = 512
      memory    = 1024
      portMappings = [{
        containerPort = local.otel_collector_port
        hostPort      = local.otel_collector_port
        protocol      = "tcp"
      }]
      environment = [
        { name = "AOT_CONFIG_CONTENT", value = file("${path.module}/otel/collector.yaml") },
        { name = "AWS_REGION", value = var.aws_region },
        { name = "AMP_REMOTE_WRITE_ENDPOINT", value = "${aws_prometheus_workspace.this[0].prometheus_endpoint}api/v1/remote_write" },
        { name = "OTEL_LOG_GROUP", value = aws_cloudwatch_log_group.otel_logs[0].name },
      ]
      readonlyRootFilesystem = true
      healthCheck = {
        command     = ["CMD", "/healthcheck"]
        interval    = 15
        timeout     = 5
        retries     = 3
        startPeriod = 30
      }
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.otel_collector[0].name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }
    }
  ])
}

# One task: while it is down the services keep running and only lose telemetry for that time. A deployment starts the
# new task before it stops the old one.
resource "aws_ecs_service" "otel_collector" {
  count = var.services_enabled && var.otel_collector_enabled ? 1 : 0

  name                               = "${local.environment_name}-${local.otel_collector_name}"
  cluster                            = aws_ecs_cluster.this.id
  task_definition                    = aws_ecs_task_definition.otel_collector[0].arn
  desired_count                      = 1
  launch_type                        = "FARGATE"
  platform_version                   = "1.4.0"
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  enable_ecs_managed_tags            = true
  propagate_tags                     = "SERVICE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.otel_collector[0].id]
    assign_public_ip = false
  }

  service_registries {
    registry_arn = aws_service_discovery_service.otel_collector[0].arn
  }
}
