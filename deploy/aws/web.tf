variable "cookie_secure" {
  description = "Whether identity-service and the CSRF cookie carry Secure. The web apps are served over HTTPS, so this is true."
  type        = bool
  default     = true
}

variable "domain_name" {
  description = "A domain whose DNS you control. The customer app is served at shop.<domain_name> and the staff app at staff.<domain_name>."
  type        = string
}

locals {
  web_hosts = {
    customer-web = "shop.${var.domain_name}"
    staff-web    = "staff.${var.domain_name}"
  }
  web_apps = toset(keys(local.web_hosts))

  web_service_environment = {
    identity-service = {
      PUBLIC_APP_URL = "https://${local.web_hosts["customer-web"]}"
    }
    catalog-service = {
      SEAWEEDFS_ENDPOINT         = "https://s3.us-east-1.amazonaws.com"
      SEAWEEDFS_MEDIA_BUCKET     = aws_s3_bucket.media.bucket
      SEAWEEDFS_PUBLIC_MEDIA_URL = "https://${aws_s3_bucket.media.bucket_regional_domain_name}"
    }
  }
  web_service_secrets = {
    catalog-service = { for name, secret in aws_secretsmanager_secret.catalog_media : name => secret.arn }
  }
}

resource "random_id" "web" {
  byte_length = 4
}

# Product images are public by design: the catalog stores their plain URLs and the browsers load them directly.
resource "aws_s3_bucket" "media" {
  bucket        = "${local.environment_name}-media-${random_id.web.hex}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket                  = aws_s3_bucket.media.id
  block_public_acls       = true
  block_public_policy     = false
  ignore_public_acls      = true
  restrict_public_buckets = false
}

resource "aws_s3_bucket_policy" "media" {
  bucket     = aws_s3_bucket.media.id
  depends_on = [aws_s3_bucket_public_access_block.media]

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "PublicReadProductImages"
      Effect    = "Allow"
      Principal = "*"
      Action    = ["s3:GetObject"]
      Resource  = "${aws_s3_bucket.media.arn}/product-images/*"
    }]
  })
}

# One ALB per web app, so staff and customer get different hostnames and their cookies never collide. The DNS lives
# outside AWS: add the records from the certificate_validation_records and site_cnames outputs at your DNS provider.
resource "aws_acm_certificate" "web" {
  domain_name               = local.web_hosts["customer-web"]
  subject_alternative_names = [local.web_hosts["staff-web"]]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# Waits until the validation records exist at the DNS provider and ACM has issued the certificate.
resource "aws_acm_certificate_validation" "web" {
  certificate_arn = aws_acm_certificate.web.arn
}

resource "aws_security_group" "web_alb" {
  name        = "${local.environment_name}-web-alb"
  description = "Public ALBs in front of the web app containers"
  vpc_id      = aws_vpc.this.id

  ingress {
    description = "HTTP from the internet, redirected to HTTPS"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS from the internet"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description     = "Web containers on port 8080"
    from_port       = 8080
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
  }
}

resource "aws_security_group_rule" "tasks_ingress_web_alb" {
  type                     = "ingress"
  description              = "Allow HTTP on port 8080 from the web app ALBs"
  from_port                = 8080
  to_port                  = 8080
  protocol                 = "tcp"
  security_group_id        = aws_security_group.ecs_tasks.id
  source_security_group_id = aws_security_group.web_alb.id
}

resource "aws_lb" "web" {
  for_each = local.web_apps

  name               = substr("${local.environment_name}-${each.key}", 0, 32)
  load_balancer_type = "application"
  security_groups    = [aws_security_group.web_alb.id]
  subnets            = aws_subnet.public[*].id
}

resource "aws_lb_target_group" "web" {
  for_each = local.web_apps

  name        = substr("${local.environment_name}-${each.key}", 0, 32)
  port        = 8080
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.this.id

  health_check {
    path    = "/"
    matcher = "200-399"
  }
}

resource "aws_lb_listener" "web" {
  for_each = local.web_apps

  load_balancer_arn = aws_lb.web[each.key].arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.web.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web[each.key].arn
  }
}

resource "aws_lb_listener" "web_http" {
  for_each = local.web_apps

  load_balancer_arn = aws_lb.web[each.key].arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_cloudwatch_log_group" "web" {
  for_each = local.web_apps

  name              = "/ecs/${local.environment_name}/${each.key}"
  retention_in_days = var.log_retention_in_days
}

# The nginx image writes its server config at start, so its root filesystem stays writable (no readonlyRootFilesystem).
resource "aws_ecs_task_definition" "web" {
  for_each = local.web_apps

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

  container_definitions = jsonencode([{
    name      = each.key
    image     = "${aws_ecr_repository.service[each.key].repository_url}:${var.image_tag}"
    essential = true
    cpu       = var.task_cpu
    memory    = var.task_memory
    portMappings = [{
      containerPort = 8080
      hostPort      = 8080
      protocol      = "tcp"
    }]
    environment = [{ name = "API_BASE_URL", value = aws_apigatewayv2_api.public.api_endpoint }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.web[each.key].name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "ecs"
      }
    }
  }])
}

resource "aws_ecs_service" "web" {
  for_each = var.services_enabled ? local.web_apps : toset([])

  name                    = "${local.environment_name}-${each.key}"
  cluster                 = aws_ecs_cluster.this.id
  task_definition         = aws_ecs_task_definition.web[each.key].arn
  desired_count           = var.desired_count
  launch_type             = "FARGATE"
  platform_version        = "1.4.0"
  enable_ecs_managed_tags = true
  propagate_tags          = "SERVICE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web[each.key].arn
    container_name   = each.key
    container_port   = 8080
  }

  depends_on = [aws_lb_listener.web]
}

resource "aws_iam_user" "catalog_media" {
  name = "${local.environment_name}-catalog-media"
}

resource "aws_iam_user_policy" "catalog_media" {
  name = "put-product-media"
  user = aws_iam_user.catalog_media.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:PutObject"]
      Resource = "${aws_s3_bucket.media.arn}/*"
    }]
  })
}

resource "aws_iam_access_key" "catalog_media" {
  user = aws_iam_user.catalog_media.name
}

resource "aws_secretsmanager_secret" "catalog_media" {
  for_each = toset(["SEAWEEDFS_ACCESS_KEY", "SEAWEEDFS_SECRET_KEY"])

  name                    = "${local.environment_name}/catalog-service/${each.key}"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "catalog_media" {
  for_each = aws_secretsmanager_secret.catalog_media

  secret_id     = each.value.id
  secret_string = each.key == "SEAWEEDFS_SECRET_KEY" ? aws_iam_access_key.catalog_media.secret : aws_iam_access_key.catalog_media.id
}

output "web" {
  value = {
    staff_url      = "https://${local.web_hosts["staff-web"]}"
    customer_url   = "https://${local.web_hosts["customer-web"]}"
    media_bucket   = aws_s3_bucket.media.bucket
    media_base_url = "https://${aws_s3_bucket.media.bucket_regional_domain_name}"
  }
}

output "certificate_validation_records" {
  description = "CNAME records that prove ownership of the domain to ACM."
  value = [for o in aws_acm_certificate.web.domain_validation_options : {
    name  = o.resource_record_name
    type  = o.resource_record_type
    value = o.resource_record_value
  }]
}

output "site_cnames" {
  description = "CNAME records that send each host to its load balancer."
  value       = { for app, host in local.web_hosts : host => aws_lb.web[app].dns_name }
}
