variable "domain_name" {
  description = "The domain of the Cloudflare zone cloudflare_zone_id. The customer app is served at shop.<domain_name> and the staff app at staff.<domain_name>."
  type        = string
}

variable "cloudflare_zone_id" {
  description = "ID of the Cloudflare zone of domain_name. Terraform creates the certificate validation records and the two site CNAMEs there."
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
      AWS_ENDPOINT_URL_S3 = "https://s3.us-east-1.amazonaws.com"
      AWS_REGION          = "us-east-1"
      MEDIA_BUCKET        = aws_s3_bucket.media.bucket
      PUBLIC_MEDIA_URL    = "https://${aws_s3_bucket.media.bucket_regional_domain_name}"
    }
  }
  web_service_secrets = {
    catalog-service = { for name, parameter in aws_ssm_parameter.catalog_media : name => parameter.arn }
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

# One public ALB serves both web apps on two hostnames, so the staff and customer tokens never share an origin. The DNS lives in
# Cloudflare and is managed below, DNS only (not proxied). allow_overwrite takes over a record that already exists.
resource "aws_acm_certificate" "web" {
  domain_name               = local.web_hosts["customer-web"]
  subject_alternative_names = concat([local.web_hosts["staff-web"]], var.grafana_enabled ? [local.grafana_host] : [])
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "cloudflare_record" "certificate_validation" {
  for_each = { for option in aws_acm_certificate.web.domain_validation_options : option.domain_name => option }

  zone_id         = var.cloudflare_zone_id
  name            = trimsuffix(each.value.resource_record_name, ".")
  type            = each.value.resource_record_type
  content         = trimsuffix(each.value.resource_record_value, ".")
  ttl             = 1
  proxied         = false
  allow_overwrite = true
}

resource "cloudflare_record" "site" {
  for_each = local.web_hosts

  zone_id         = var.cloudflare_zone_id
  name            = each.value
  type            = "CNAME"
  content         = aws_lb.web.dns_name
  ttl             = 1
  proxied         = false
  allow_overwrite = true
}

# Waits until ACM has found the validation records and issued the certificate.
resource "aws_acm_certificate_validation" "web" {
  certificate_arn         = aws_acm_certificate.web.arn
  validation_record_fqdns = [for record in cloudflare_record.certificate_validation : record.hostname]
}

resource "aws_security_group" "web_alb" {
  name        = "${local.environment_name}-web-alb"
  description = "Public ALB in front of the web app containers"
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

  egress {
    description     = "Grafana on port 3000"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
  }
}

resource "aws_security_group_rule" "tasks_ingress_web_alb" {
  type                     = "ingress"
  description              = "Allow HTTP on port 8080 from the web app ALB"
  from_port                = 8080
  to_port                  = 8080
  protocol                 = "tcp"
  security_group_id        = aws_security_group.ecs_tasks.id
  source_security_group_id = aws_security_group.web_alb.id
}

resource "aws_lb" "web" {
  name               = substr("${local.environment_name}-web", 0, 32)
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
  load_balancer_arn = aws_lb.web.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.web.certificate_arn

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Not found"
      status_code  = "404"
    }
  }
}

resource "aws_lb_listener_rule" "web" {
  for_each = local.web_apps

  listener_arn = aws_lb_listener.web.arn

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web[each.key].arn
  }

  condition {
    host_header {
      values = [local.web_hosts[each.key]]
    }
  }
}

resource "aws_lb_listener" "web_http" {
  load_balancer_arn = aws_lb.web.arn
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
  cpu                      = var.web_task_cpu
  memory                   = var.web_task_memory
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
    cpu       = var.web_task_cpu
    memory    = var.web_task_memory
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

  name             = "${local.environment_name}-${each.key}"
  cluster          = aws_ecs_cluster.this.id
  task_definition  = aws_ecs_task_definition.web[each.key].arn
  desired_count    = var.desired_count
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
    target_group_arn = aws_lb_target_group.web[each.key].arn
    container_name   = each.key
    container_port   = 8080
  }

  depends_on = [aws_lb_listener_rule.web]
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

resource "aws_ssm_parameter" "catalog_media" {
  for_each = toset(["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"])

  name  = "/${local.environment_name}/catalog-service/${each.key}"
  type  = "SecureString"
  value = each.key == "AWS_SECRET_ACCESS_KEY" ? aws_iam_access_key.catalog_media.secret : aws_iam_access_key.catalog_media.id
}

output "web" {
  value = {
    staff_url      = "https://${local.web_hosts["staff-web"]}"
    customer_url   = "https://${local.web_hosts["customer-web"]}"
    media_bucket   = aws_s3_bucket.media.bucket
    media_base_url = "https://${aws_s3_bucket.media.bucket_regional_domain_name}"
    grafana_url    = var.grafana_enabled ? "https://${local.grafana_host}" : null
  }
}
