variable "aws_region" {
  description = "AWS region for the environment."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Short name used for AWS resource names."
  type        = string
  default     = "pharmacy-central"
}

variable "environment" {
  description = "Deployment environment name. It is part of resource names and the Cloud Map namespace <environment>.pharmacy.internal."
  type        = string
  default     = "staging"
}

variable "image_tag" {
  description = "Tag of the backend and ops images in their ECR repositories. Set by tools/aws-env.mjs or with -var."
  type        = string
}

variable "service_environment_extra" {
  description = "Non-secret environment variables per service, from the root .env (written by tools/aws-env.mjs)."
  type        = map(map(string))
  default     = {}
}

variable "service_secret_values" {
  description = "Secret environment variables per service, from the root .env. Each becomes a Secrets Manager secret injected into that service."
  type        = map(map(string))
  default     = {}
  sensitive   = true
}

variable "ops_secret_values" {
  description = "Secret environment variables for the ops task (for example DEMO_ACCOUNT_PASSWORD)."
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "services_enabled" {
  description = "Whether to create and run ECS long-running services and autoscaling. Set to false for the first apply so database migrations can run before services start."
  type        = bool
  default     = false
}

variable "otel_collector_enabled" {
  description = "Run the OpenTelemetry collector and Managed Prometheus. Off, the services' OTLP endpoint is unreachable and spans are dropped."
  type        = bool
  default     = false
}

variable "embedder_enabled" {
  description = "Run the self-hosted product search embedder and wire catalog-service and search-service to it."
  type        = bool
  default     = false
}

variable "task_cpu" {
  description = "Fargate task CPU units shared by backend services."
  type        = number
  default     = 256
}

variable "task_memory" {
  description = "Fargate task memory in MiB shared by backend services."
  type        = number
  default     = 512
}

variable "sales_task_cpu" {
  description = "Fargate task CPU units for sales-service, which overrides task_cpu."
  type        = number
  default     = 512
}

variable "sales_task_memory" {
  description = "Fargate task memory in MiB for sales-service. Must be a valid Fargate pair with sales_task_cpu."
  type        = number
  default     = 1024
}

variable "desired_count" {
  description = "Minimum number of tasks per backend service."
  type        = number
  default     = 1

  validation {
    condition     = var.desired_count >= 1
    error_message = "Services must keep at least one task running."
  }
}

variable "max_count" {
  description = "Maximum number of tasks per backend service for autoscaling."
  type        = number
  default     = 1

  validation {
    condition     = var.max_count >= 1
    error_message = "Autoscaling max count must be at least 1."
  }
}

variable "autoscaling_cpu_target_value" {
  description = "Target average CPU utilization percentage for backend service autoscaling."
  type        = number
  default     = 70.0
}

variable "autoscaling_memory_target_value" {
  description = "Target average memory utilization percentage for backend service autoscaling."
  type        = number
  default     = 80.0
}

variable "throttling_burst_limit" {
  description = "AWS API Gateway burst limit for the default route."
  type        = number
  default     = 200
}

variable "throttling_rate_limit" {
  description = "AWS API Gateway steady-state requests per second for the default route."
  type        = number
  default     = 100
}

variable "log_retention_in_days" {
  description = "CloudWatch log retention in days for ECS services, Lambda functions, and API Gateway access logs."
  type        = number
  default     = 30
}
