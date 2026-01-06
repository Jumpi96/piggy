# SNS Topic for Lambda Failure Alerts
resource "aws_sns_topic" "lambda_alerts" {
  name = "piggy-lambda-alerts"
}

resource "aws_sns_topic_subscription" "email_alert" {
  topic_arn = aws_sns_topic.lambda_alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# CloudWatch Alarm for Backup Lambda Errors
resource "aws_cloudwatch_metric_alarm" "backup_lambda_errors" {
  alarm_name          = "piggy-backup-lambda-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "Alert when backup lambda fails"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.backup.function_name
  }

  alarm_actions = [aws_sns_topic.lambda_alerts.arn]
}

