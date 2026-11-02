output "ecr_repository_urls" {
  description = "ECR repository URL per backend service and for ops. Images are pushed as <url>:<image_tag>."
  value       = { for name, repository in aws_ecr_repository.service : name => repository.repository_url }
}

output "ecs_cluster_name" {
  description = "ECS cluster name."
  value       = aws_ecs_cluster.this.name
}

output "private_subnet_ids" {
  description = "Private subnet IDs where ECS tasks run."
  value       = aws_subnet.private[*].id
}

output "ecs_tasks_security_group_id" {
  description = "Security group ID for backend ECS Fargate tasks."
  value       = aws_security_group.ecs_tasks.id
}

output "api_gateway_url" {
  description = "Public API URL. The web containers proxy /api to it."
  value       = aws_apigatewayv2_api.public.api_endpoint
}

output "ops_task_definition" {
  description = "Task definition ARN of the ops task that runs roles.sh, the database creation SQL, seed.mjs (default seed) and seed-demo.mjs (demo accounts)."
  value       = aws_ecs_task_definition.ops.arn
}

output "migration_task_definitions" {
  description = "Task definition ARN of the one-shot database migration per service."
  value       = { for name, task in aws_ecs_task_definition.migration : name => task.arn }
}

output "github_ci_role_arn" {
  description = "Role that GitHub Actions assumes (variable AWS_ROLE_ARN in the repository)."
  value       = aws_iam_role.github_ci.arn
}
