variable "grafana_enabled" {
  description = "Run Grafana on Fargate at grafana.<domain_name>, reading the stack's CloudWatch metrics and logs. It uses 0.25 vCPU of the Fargate quota; a migration or ops task started while it runs needs the 0.5 vCPU that is left, so set false to free it."
  type        = bool
  default     = true
}

locals {
  grafana_host = "grafana.${var.domain_name}"
}

resource "random_password" "grafana_admin" {
  count = var.grafana_enabled ? 1 : 0

  length  = 24
  special = false
}

# Read the password with: aws ssm get-parameter --with-decryption --name /<environment>/grafana/admin-password
resource "aws_ssm_parameter" "grafana_admin_password" {
  count = var.grafana_enabled ? 1 : 0

  name  = "/${local.environment_name}/grafana/admin-password"
  type  = "SecureString"
  value = random_password.grafana_admin[0].result
}

resource "cloudflare_record" "grafana" {
  count = var.grafana_enabled ? 1 : 0

  zone_id         = var.cloudflare_zone_id
  name            = local.grafana_host
  type            = "CNAME"
  content         = aws_lb.web.dns_name
  ttl             = 1
  proxied         = false
  allow_overwrite = true
}

resource "aws_security_group_rule" "tasks_ingress_grafana" {
  count = var.grafana_enabled ? 1 : 0

  type                     = "ingress"
  description              = "Allow HTTP on port 3000 from the web app ALB"
  from_port                = 3000
  to_port                  = 3000
  protocol                 = "tcp"
  security_group_id        = aws_security_group.ecs_tasks.id
  source_security_group_id = aws_security_group.web_alb.id
}

resource "aws_lb_target_group" "grafana" {
  count = var.grafana_enabled ? 1 : 0

  name        = substr("${local.environment_name}-grafana", 0, 32)
  port        = 3000
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.this.id

  health_check {
    path    = "/api/health"
    matcher = "200"
  }
}

resource "aws_lb_listener_rule" "grafana" {
  count = var.grafana_enabled ? 1 : 0

  listener_arn = aws_lb_listener.web.arn

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.grafana[0].arn
  }

  condition {
    host_header {
      values = [local.grafana_host]
    }
  }
}

# Grafana reads CloudWatch with the task role: ECS, ALB, RDS, ElastiCache and API Gateway metrics, and the services' log groups.
resource "aws_iam_role" "grafana" {
  count = var.grafana_enabled ? 1 : 0

  name = "${local.environment_name}-grafana"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "grafana_cloudwatch" {
  count = var.grafana_enabled ? 1 : 0

  role       = aws_iam_role.grafana[0].name
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchReadOnlyAccess"
}

resource "aws_cloudwatch_log_group" "grafana" {
  count = var.grafana_enabled ? 1 : 0

  name              = "/ecs/${local.environment_name}/grafana"
  retention_in_days = var.log_retention_in_days
}

# The CloudWatch data source and the "Pharmacy Central - AWS" dashboard (grafana-dashboard.json.tftpl) are provisioned at start from
# files written under /tmp, because the image has no volume to mount.
locals {
  grafana_dashboard_b64 = base64encode(templatefile("${path.module}/grafana-dashboard.json.tftpl", {
    cluster = aws_ecs_cluster.this.name
  }))
}

resource "aws_ecs_task_definition" "grafana" {
  count = var.grafana_enabled ? 1 : 0

  family                   = "${local.environment_name}-grafana"
  cpu                      = 256
  memory                   = 1024
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.grafana[0].arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name       = "grafana"
    image      = "grafana/grafana:13.2.4@sha256:dbbc38ea21103cefb50396340cd88afec779c7e070b0a7bf5a75b4ce46651d3f"
    essential  = true
    entryPoint = ["/bin/sh", "-c"]
    command = [
      join(" && ", [
        "mkdir -p /tmp/provisioning/datasources /tmp/provisioning/dashboards /tmp/dashboards",
        "printf 'apiVersion: 1\\ndatasources:\\n  - name: CloudWatch\\n    uid: cloudwatch\\n    type: cloudwatch\\n    isDefault: true\\n    jsonData:\\n      authType: default\\n      defaultRegion: ${var.aws_region}\\n' > /tmp/provisioning/datasources/cloudwatch.yaml",
        "printf 'apiVersion: 1\\nproviders:\\n  - name: aws\\n    type: file\\n    options:\\n      path: /tmp/dashboards\\n' > /tmp/provisioning/dashboards/aws.yaml",
        "echo \"$GRAFANA_DASHBOARD_B64\" | base64 -d > /tmp/dashboards/pharmacy-aws.json",
        "exec /run.sh",
      ])
    ]
    portMappings = [{
      containerPort = 3000
      hostPort      = 3000
      protocol      = "tcp"
    }]
    environment = [
      { name = "GF_PATHS_PROVISIONING", value = "/tmp/provisioning" },
      { name = "GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH", value = "/tmp/dashboards/pharmacy-aws.json" },
      { name = "GRAFANA_DASHBOARD_B64", value = local.grafana_dashboard_b64 },
      { name = "GF_SECURITY_ADMIN_USER", value = "admin" },
      { name = "GF_SERVER_ROOT_URL", value = "https://${local.grafana_host}" },
      { name = "GF_USERS_ALLOW_SIGN_UP", value = "false" },
      { name = "GF_AUTH_ANONYMOUS_ENABLED", value = "false" },
    ]
    secrets = [{ name = "GF_SECURITY_ADMIN_PASSWORD", valueFrom = aws_ssm_parameter.grafana_admin_password[0].arn }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.grafana[0].name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "ecs"
      }
    }
  }])
}

resource "aws_ecs_service" "grafana" {
  count = var.grafana_enabled && var.services_enabled ? 1 : 0

  name             = "${local.environment_name}-grafana"
  cluster          = aws_ecs_cluster.this.id
  task_definition  = aws_ecs_task_definition.grafana[0].arn
  desired_count    = 1
  launch_type      = "FARGATE"
  platform_version = "1.4.0"
  # Stop the old task before starting the new one, so a rolling deploy never exceeds the Fargate vCPU quota.
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100
  enable_ecs_managed_tags            = true
  propagate_tags                     = "SERVICE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.grafana[0].arn
    container_name   = "grafana"
    container_port   = 3000
  }

  depends_on = [aws_lb_listener_rule.grafana]
}
