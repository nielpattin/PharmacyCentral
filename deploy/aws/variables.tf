variable "aws_region" {
  description = "AWS region for the environment."
  type        = string
  default     = "ap-southeast-1"
}

variable "project_name" {
  description = "Short name used for AWS resource names."
  type        = string
  default     = "pharmacy-central"
}

variable "environment" {
  description = "Deployment environment name."
  type        = string
  default     = "staging"
}

variable "vpc_id" {
  description = "VPC that contains the private ECS services."
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnets for Fargate tasks, Lambda functions, and the internal load balancer."
  type        = list(string)

  validation {
    condition     = length(var.private_subnet_ids) >= 2
    error_message = "At least two private subnets in different availability zones are required."
  }
}

variable "api_gateway_subnet_ids" {
  description = "Private subnets used by the API Gateway VPC link."
  type        = list(string)

  validation {
    condition     = length(var.api_gateway_subnet_ids) >= 2
    error_message = "At least two API Gateway VPC link subnets are required."
  }
}

variable "repository_credentials_secret_arn" {
  description = "Optional Secrets Manager secret ARN containing credentials (e.g. GitHub PAT) for pulling images from a private repository like GHCR."
  type        = string
  default     = null
}

variable "images" {
  description = "Immutable container image references for backend services."
  type        = map(string)

  validation {
    condition = alltrue([
      for service in ["identity-service", "catalog-service", "inventory-service", "sales-service", "payment-service", "operations-query-service", "chatbot-service"] :
      contains(keys(var.images), service) && strcontains(var.images[service], "@sha256:")
    ])
    error_message = "Every backend service image must be provided as an immutable image@sha256:digest reference."
  }
}

variable "service_environment" {
  description = "Non-secret environment variables keyed by service name."
  type        = map(map(string))
  default     = {}
}

variable "shared_secrets" {
  description = "Secrets Manager ARNs injected into every backend service."
  type        = map(string)
  default     = {}
}

variable "service_secrets" {
  description = "Additional Secrets Manager ARNs keyed by service and environment variable name."
  type        = map(map(string))
  default     = {}
}

variable "services_enabled" {
  description = "Whether to create and run ECS long-running services and autoscaling. Set to false for initial bootstrap so database migrations can run before services start."
  type        = bool
  default     = false
}

variable "task_cpu" {
  description = "Fargate task CPU units shared by backend services."
  type        = number
  default     = 512
}

variable "task_memory" {
  description = "Fargate task memory in MiB shared by backend services."
  type        = number
  default     = 1024
}

variable "desired_count" {
  description = "Minimum number of tasks per backend service."
  type        = number
  default     = 2

  validation {
    condition     = var.desired_count >= 1
    error_message = "Production services must keep at least one task running."
  }
}

variable "max_count" {
  description = "Maximum number of tasks per backend service for autoscaling."
  type        = number
  default     = 10

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

variable "authorizer_environment" {
  description = "Additional environment variables for the authorizer Lambda function."
  type        = map(string)
  default     = {}
}

variable "authorizer_secrets" {
  description = "Secrets Manager ARNs passed to the authorizer Lambda function as environment variables."
  type        = map(string)
  default     = {}
}

variable "allowed_origins" {
  description = "Browser origins allowed by the managed API gateway."
  type        = list(string)

  validation {
    condition     = length(var.allowed_origins) > 0
    error_message = "At least one explicit browser origin is required."
  }
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
