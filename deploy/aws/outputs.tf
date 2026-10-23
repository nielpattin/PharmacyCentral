output "api_gateway_url" {
  description = "Public API URL."
  value       = aws_apigatewayv2_api.public.api_endpoint
}

output "ecs_cluster_name" {
  description = "ECS cluster name."
  value       = aws_ecs_cluster.this.name
}

output "ecs_service_names" {
  description = "Names of the ECS services when enabled."
  value       = { for name, svc in aws_ecs_service.service : name => svc.name }
}

output "service_task_definition_arns" {
  description = "Task definition ARNs for long-running backend ECS services."
  value       = { for name, task in aws_ecs_task_definition.service : name => task.arn }
}

output "migration_task_definition_arns" {
  description = "Task definition ARNs for running one-shot database migrations."
  value       = { for name, task in aws_ecs_task_definition.migration : name => task.arn }
}

output "migration_task_definition_families" {
  description = "Task definition family names for database migrations."
  value       = { for name, task in aws_ecs_task_definition.migration : name => task.family }
}

output "services_enabled" {
  description = "Whether ECS long-running services and autoscaling are currently enabled."
  value       = var.services_enabled
}

output "private_subnet_ids" {
  description = "Private subnet IDs used for running ECS tasks and services."
  value       = var.private_subnet_ids
}

output "internal_load_balancer_dns_name" {
  description = "Internal ALB DNS name."
  value       = aws_lb.internal.dns_name
}

output "service_discovery_namespace" {
  description = "Private DNS namespace used by service-to-service calls."
  value       = aws_service_discovery_private_dns_namespace.this.name
}

output "service_discovery_names" {
  description = "Cloud Map names for the backend services."
  value       = { for name, service in aws_service_discovery_service.service : name => service.name }
}

output "authorizer_lambda_function_name" {
  description = "Name of the request authorizer Lambda function."
  value       = aws_lambda_function.authorizer.function_name
}

output "csrf_lambda_function_name" {
  description = "Name of the CSRF token generator Lambda function."
  value       = aws_lambda_function.csrf.function_name
}

output "api_gateway_access_log_group" {
  description = "CloudWatch log group for API Gateway access logs."
  value       = aws_cloudwatch_log_group.api_gateway_access_logs.name
}

output "vpc_link_security_group_id" {
  description = "Security group ID for API Gateway VPC Link."
  value       = aws_security_group.vpc_link.id
}

output "alb_security_group_id" {
  description = "Security group ID for internal Application Load Balancer."
  value       = aws_security_group.alb.id
}

output "ecs_tasks_security_group_id" {
  description = "Security group ID for backend ECS Fargate tasks."
  value       = aws_security_group.ecs_tasks.id
}

output "authorizer_lambda_security_group_id" {
  description = "Security group ID for authorizer Lambda."
  value       = aws_security_group.lambda.id
}

output "embedder_service_name" {
  description = "Name of the embedder ECS service (populated when services_enabled = true)."
  value       = one(aws_ecs_service.embedder[*].name)
}

output "embedder_task_definition_arn" {
  description = "Task definition ARN of the self-hosted product search embedder."
  value       = aws_ecs_task_definition.embedder.arn
}

output "embedder_internal_url" {
  description = "Private OpenAI-compatible base URL that catalog-service and search-service call (Cloud Map name, port 80, /v1)."
  value       = local.embedder_url
}

output "embedder_security_group_id" {
  description = "Security group ID for the embedder task. Accepts traffic on port 80 from embedder_client_security_group_id only."
  value       = aws_security_group.embedder.id
}

output "embedder_client_security_group_id" {
  description = "Security group ID attached to catalog-service and search-service tasks, the only clients allowed to reach the embedder."
  value       = aws_security_group.embedder_client.id
}
