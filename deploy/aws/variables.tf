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
  description = "Secret environment variables per service, from the root .env. Each becomes an SSM SecureString parameter injected into that service."
  type        = map(map(string))
  default     = {}
  sensitive   = true
}

variable "ops_secret_values" {
  description = "Secret environment variables for the ops task (ADMIN_PASSWORD, and DEMO_ACCOUNT_PASSWORD for the demo seed)."
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
  description = "Fargate task CPU units for the backend, migration and ops tasks. 512 is 0.5 vCPU; the pair with task_memory must be a valid Fargate combination. Sized to fit the 6 vCPU On-Demand Fargate quota."
  type        = number
  default     = 512
}

variable "task_memory" {
  description = "Fargate task memory in MiB for the backend, migration and ops tasks. 2048 MiB pairs with 512 CPU units (Fargate allows 1 to 4 GB at 0.5 vCPU)."
  type        = number
  default     = 2048
}

variable "web_task_cpu" {
  description = "Fargate task CPU units for the customer-web and staff-web tasks (nginx). 256 is 0.25 vCPU; valid with web_task_memory."
  type        = number
  default     = 256
}

variable "web_task_memory" {
  description = "Fargate task memory in MiB for the customer-web and staff-web tasks. 512 MiB pairs with 256 CPU units."
  type        = number
  default     = 512
}

variable "desired_count" {
  description = "Default number of tasks per ECS service (backend and web) when service_desired_count does not name it. Applied on every apply while autoscaling_enabled is false."
  type        = number
  default     = 1

  validation {
    condition     = var.desired_count >= 1
    error_message = "Services must keep at least one task running."
  }
}

variable "service_desired_count" {
  description = "Optional per-service task count overrides, keyed by service name (backend and web). 0 stops the service. Services not listed use desired_count (1). Applied on every apply while autoscaling_enabled is false. Each backend task is 0.5 vCPU against the Fargate vCPU quota."
  type        = map(number)
  default     = {}

  validation {
    condition     = alltrue([for count in values(var.service_desired_count) : count >= 0])
    error_message = "Each service in service_desired_count must be 0 (stopped) or more."
  }
}

variable "autoscaling_enabled" {
  description = "Enable ECS Application Auto Scaling for backend services (autoscaling.tf). Off by default: services run the fixed counts in service_desired_count. When on, the scalable target owns the count between autoscale_min_capacity and autoscale_max_capacity."
  type        = bool
  default     = false
}

variable "autoscale_min_capacity" {
  description = "Minimum task count for autoscaled services."
  type        = number
  default     = 1

  validation {
    condition     = var.autoscale_min_capacity >= 1
    error_message = "Autoscaled services must keep at least one task running."
  }
}

variable "autoscale_max_capacity" {
  description = "Maximum task count for autoscaled services (bounded by the Fargate vCPU quota of the account)."
  type        = number
  default     = 3

  validation {
    condition     = var.autoscale_max_capacity >= 1
    error_message = "The autoscaling maximum must allow at least one task."
  }
}

variable "autoscale_cpu_target_percent" {
  description = "Target average CPU utilization percent that triggers scale-out."
  type        = number
  default     = 50

  validation {
    condition     = var.autoscale_cpu_target_percent > 0 && var.autoscale_cpu_target_percent <= 100
    error_message = "The CPU target must be a percentage in (0, 100]."
  }
}

variable "autoscale_memory_target_percent" {
  description = "Target average memory utilization percent for the second target tracking policy."
  type        = number
  default     = 70

  validation {
    condition     = var.autoscale_memory_target_percent > 0 && var.autoscale_memory_target_percent <= 100
    error_message = "The memory target must be a percentage in (0, 100]."
  }
}

variable "throttling_burst_limit" {
  description = "AWS API Gateway burst limit for the default route."
  type        = number
  default     = 2000
}

variable "throttling_rate_limit" {
  description = "AWS API Gateway steady-state requests per second for the default route."
  type        = number
  default     = 1000
}

variable "log_retention_in_days" {
  description = "CloudWatch log retention in days for ECS services and API Gateway access logs."
  type        = number
  default     = 7
}
