# Cost watch. Credits hide the real spend in Cost Explorer (net is about 0), so both budgets exclude Credit and Refund and
# track the gross cost. Alerts go to var.cost_alert_email.
variable "cost_alert_email" {
  description = "Email that receives the budget and anomaly alerts."
  type        = string
}

variable "daily_budget_usd" {
  description = "Gross (before credits) daily spend that triggers an alert. The full stack runs at about 11.2 USD a day."
  type        = number
  default     = 12
}

variable "monthly_budget_usd" {
  description = "Gross (before credits) monthly spend budget."
  type        = number
  default     = 350
}

variable "anomaly_threshold_usd" {
  description = "Smallest total anomaly impact that sends an alert."
  type        = number
  default     = 5
}

variable "anomaly_monitor_arn" {
  description = "ARN of the account's default Services anomaly monitor. AWS allows one dimensional monitor per account, so it is reused, not created."
  type        = string
}

locals {
  # Without Credit and Refund the budget sees the cost before credits are applied.
  budget_cost_types = {
    include_credit             = false
    include_refund             = false
    include_discount           = true
    include_other_subscription = true
    include_recurring          = true
    include_support            = true
    include_tax                = true
    include_subscription       = true
    include_upfront            = true
    use_amortized              = false
    use_blended                = false
  }
}

resource "aws_sns_topic" "cost_alerts" {
  name = "${local.environment_name}-cost-alerts"
}

resource "aws_sns_topic_policy" "cost_alerts" {
  arn = aws_sns_topic.cost_alerts.arn

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "BudgetsAndCostAnomalyPublish"
        Effect    = "Allow"
        Principal = { Service = ["budgets.amazonaws.com", "costalerts.amazonaws.com"] }
        Action    = "SNS:Publish"
        Resource  = aws_sns_topic.cost_alerts.arn
      }
    ]
  })
}

resource "aws_sns_topic_subscription" "cost_alerts_email" {
  topic_arn = aws_sns_topic.cost_alerts.arn
  protocol  = "email"
  endpoint  = var.cost_alert_email
}

resource "aws_budgets_budget" "daily" {
  name         = "${local.environment_name}-daily-gross"
  budget_type  = "COST"
  limit_amount = tostring(var.daily_budget_usd)
  limit_unit   = "USD"
  time_unit    = "DAILY"

  cost_types {
    include_credit             = local.budget_cost_types.include_credit
    include_refund             = local.budget_cost_types.include_refund
    include_discount           = local.budget_cost_types.include_discount
    include_other_subscription = local.budget_cost_types.include_other_subscription
    include_recurring          = local.budget_cost_types.include_recurring
    include_support            = local.budget_cost_types.include_support
    include_tax                = local.budget_cost_types.include_tax
    include_subscription       = local.budget_cost_types.include_subscription
    include_upfront            = local.budget_cost_types.include_upfront
    use_amortized              = local.budget_cost_types.use_amortized
    use_blended                = local.budget_cost_types.use_blended
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.cost_alert_email]
    subscriber_sns_topic_arns  = [aws_sns_topic.cost_alerts.arn]
  }
}

resource "aws_budgets_budget" "monthly" {
  name         = "${local.environment_name}-monthly-gross"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_types {
    include_credit             = local.budget_cost_types.include_credit
    include_refund             = local.budget_cost_types.include_refund
    include_discount           = local.budget_cost_types.include_discount
    include_other_subscription = local.budget_cost_types.include_other_subscription
    include_recurring          = local.budget_cost_types.include_recurring
    include_support            = local.budget_cost_types.include_support
    include_tax                = local.budget_cost_types.include_tax
    include_subscription       = local.budget_cost_types.include_subscription
    include_upfront            = local.budget_cost_types.include_upfront
    use_amortized              = local.budget_cost_types.use_amortized
    use_blended                = local.budget_cost_types.use_blended
  }

  dynamic "notification" {
    for_each = {
      actual_50    = { threshold = 50, type = "ACTUAL" }
      actual_80    = { threshold = 80, type = "ACTUAL" }
      forecast_100 = { threshold = 100, type = "FORECASTED" }
    }

    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = notification.value.threshold
      threshold_type             = "PERCENTAGE"
      notification_type          = notification.value.type
      subscriber_email_addresses = [var.cost_alert_email]
      subscriber_sns_topic_arns  = [aws_sns_topic.cost_alerts.arn]
    }
  }
}

resource "aws_ce_anomaly_subscription" "email" {
  name             = "${local.environment_name}-anomalies"
  frequency        = "IMMEDIATE"
  monitor_arn_list = [var.anomaly_monitor_arn]

  subscriber {
    type    = "SNS"
    address = aws_sns_topic.cost_alerts.arn
  }

  threshold_expression {
    dimension {
      key           = "ANOMALY_TOTAL_IMPACT_ABSOLUTE"
      match_options = ["GREATER_THAN_OR_EQUAL"]
      values        = [tostring(var.anomaly_threshold_usd)]
    }
  }

  depends_on = [aws_sns_topic_policy.cost_alerts]
}
