# Weekly Backup Schedule
resource "aws_cloudwatch_event_rule" "weekly_backup" {
  name                = "piggy-weekly-backup"
  description         = "Trigger weekly DB backup"
  schedule_expression = "rate(7 days)"
}

resource "aws_cloudwatch_event_target" "backup_target" {
  rule      = aws_cloudwatch_event_rule.weekly_backup.name
  target_id = "BackupLambda"
  arn       = aws_lambda_function.backup.arn
}

resource "aws_lambda_permission" "allow_cloudwatch_backup" {
  statement_id  = "AllowExecutionFromCloudWatchBackup"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.backup.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.weekly_backup.arn
}

# Monthly Recurring Generation Schedule (first day of month at 2 AM UTC)
resource "aws_cloudwatch_event_rule" "monthly_recurring" {
  name                = "piggy-monthly-recurring"
  description         = "Generate recurring transactions on first day of month"
  schedule_expression = "cron(0 2 1 * ? *)"
}

resource "aws_cloudwatch_event_target" "recurring_target" {
  rule      = aws_cloudwatch_event_rule.monthly_recurring.name
  target_id = "RecurringLambda"
  arn       = aws_lambda_function.recurring_generator.arn
}

resource "aws_lambda_permission" "allow_cloudwatch_recurring" {
  statement_id  = "AllowExecutionFromCloudWatchRecurring"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.recurring_generator.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.monthly_recurring.arn
}
