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

