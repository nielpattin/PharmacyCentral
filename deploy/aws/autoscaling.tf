# ECS Application Auto Scaling for the backend services.
#
# Off by default (`autoscaling_enabled` = false): no targets or policies are created, and the services run the fixed
# counts in `service_desired_count`. Keep this file for when autoscaling is wanted again.
#
# Target tracking on average CPU (plus average memory) lets the stack absorb a load test without pinning every service
# at `autoscale_max_capacity`. The count stays between `autoscale_min_capacity` and `autoscale_max_capacity`. The
# ceiling is also bounded by the account's Fargate vCPU quota (6 vCPU today): with 0.5 vCPU per backend task, 9 backend
# services at max_capacity 3 is 13.5 vCPU, so keep `autoscale_max_capacity` low enough that the stack stays within the
# quota, or the scale-out fails to place tasks.
#
# Application Auto Scaling also needs the AWSServiceRoleForApplicationAutoScaling_ECSService service-linked role; AWS
# creates it on the first scaling call if the applying principal may call iam:CreateServiceLinkedRole.
#
# `aws_ecs_service.service` sets `desired_count` to null while autoscaling is on (main.tf), so a plan does not reset the
# count the scalable target has set. With autoscaling off there is no target, and the fixed count applies.

locals {
  autoscaled_services = var.services_enabled && var.autoscaling_enabled ? keys(local.backend_services) : []
}

resource "aws_appautoscaling_target" "service" {
  for_each = toset(local.autoscaled_services)

  service_namespace  = "ecs"
  scalable_dimension = "ecs:service:DesiredCount"
  resource_id        = "service/${aws_ecs_cluster.this.name}/${aws_ecs_service.service[each.key].name}"

  min_capacity = var.autoscale_min_capacity
  max_capacity = var.autoscale_max_capacity

  lifecycle {
    precondition {
      condition     = var.autoscale_max_capacity >= var.autoscale_min_capacity
      error_message = "autoscale_max_capacity (${var.autoscale_max_capacity}) must be at least autoscale_min_capacity (${var.autoscale_min_capacity})."
    }
  }
}

resource "aws_appautoscaling_policy" "service_cpu" {
  for_each = aws_appautoscaling_target.service

  name               = "${local.environment_name}-${each.key}-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = each.value.service_namespace
  resource_id        = each.value.resource_id
  scalable_dimension = each.value.scalable_dimension

  target_tracking_scaling_policy_configuration {
    # Scale out quickly on a CPU spike and back in slowly, so a burst of checkouts does not shed tasks mid-flight.
    target_value       = var.autoscale_cpu_target_percent
    scale_out_cooldown = 30
    scale_in_cooldown  = 60
    disable_scale_in   = false

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}

resource "aws_appautoscaling_policy" "service_memory" {
  for_each = aws_appautoscaling_target.service

  name               = "${local.environment_name}-${each.key}-memory"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = each.value.service_namespace
  resource_id        = each.value.resource_id
  scalable_dimension = each.value.scalable_dimension

  target_tracking_scaling_policy_configuration {
    target_value       = var.autoscale_memory_target_percent
    scale_out_cooldown = 30
    scale_in_cooldown  = 60
    disable_scale_in   = false

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageMemoryUtilization"
    }
  }
}
