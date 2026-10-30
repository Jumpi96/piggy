# Importers: Mercado Pago (daily report) and Santander (alert emails pushed via SES inbound).
# Both write unconfirmed rows to import_entries (the app's Inbox). See terraform/README.md
# "Automatic imports" for the one-time setup. Each importer is off until its enable_* flag is set.

locals {
  importer_dir   = "${path.module}/lambdas/importer"
  importer_files = sort(concat(["lambda_function.py", "requirements.txt"], tolist(fileset(local.importer_dir, "importer/*.py"))))
  importer_hash  = sha1(join("", [for f in local.importer_files : filesha1("${local.importer_dir}/${f}")]))
  any_importer   = var.enable_santander_import || var.enable_mp_import
  ses_rule_set   = var.existing_ses_rule_set_name != "" ? var.existing_ses_rule_set_name : "piggy-inbound"
}

data "aws_caller_identity" "current" {}

# --- Package (shared by both functions) ------------------------------------------------

resource "null_resource" "build_importer_lambda" {
  count = local.any_importer ? 1 : 0

  triggers = {
    code = local.importer_hash
  }

  provisioner "local-exec" {
    command = <<EOF
      set -e
      cd ${local.importer_dir}
      rm -rf package package.zip
      mkdir -p package
      pip install -r requirements.txt -t package/ --platform manylinux2014_x86_64 --only-binary=:all: --python-version 3.11
      cp lambda_function.py package/
      cp -r importer package/
      cd package
      zip -r ../package.zip . -x "*.pyc" -x "*__pycache__*"
    EOF
  }
}

resource "aws_iam_role" "importer" {
  count = local.any_importer ? 1 : 0
  name  = "piggy_importer_lambda_role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "importer_logs" {
  count      = local.any_importer ? 1 : 0
  role       = aws_iam_role.importer[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# --- Mercado Pago: daily report ----------------------------------------------------------

resource "aws_lambda_function" "import_mercadopago" {
  count            = var.enable_mp_import ? 1 : 0
  filename         = "${local.importer_dir}/package.zip"
  function_name    = "piggy_import_mercadopago"
  role             = aws_iam_role.importer[0].arn
  handler          = "lambda_function.handler"
  runtime          = "python3.11"
  source_code_hash = local.importer_hash
  timeout          = 120
  memory_size      = 128

  environment {
    variables = {
      IMPORT_SOURCE   = "mercadopago"
      SUPABASE_DB_URL = var.supabase_db_url
      PIGGY_USER_ID   = var.piggy_user_id
      MP_ACCESS_TOKEN = var.mp_access_token
    }
  }

  depends_on = [null_resource.build_importer_lambda]
}

# 12:30 UTC = 09:30 in Argentina, after Mercado Pago creates the daily report (about 08:45 there).
resource "aws_cloudwatch_event_rule" "import_mercadopago_daily" {
  count               = var.enable_mp_import ? 1 : 0
  name                = "piggy-import-mercadopago-daily"
  description         = "Import the Mercado Pago release report into the Piggy Inbox"
  schedule_expression = "cron(30 12 * * ? *)"
}

resource "aws_cloudwatch_event_target" "import_mercadopago_daily" {
  count     = var.enable_mp_import ? 1 : 0
  rule      = aws_cloudwatch_event_rule.import_mercadopago_daily[0].name
  target_id = "ImportMercadoPago"
  arn       = aws_lambda_function.import_mercadopago[0].arn
  input     = jsonencode({ action = "daily" })
}

resource "aws_lambda_permission" "import_mercadopago_schedule" {
  count         = var.enable_mp_import ? 1 : 0
  statement_id  = "AllowExecutionFromCloudWatchImportMercadoPago"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.import_mercadopago[0].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.import_mercadopago_daily[0].arn
}

resource "aws_cloudwatch_metric_alarm" "import_mercadopago_errors" {
  count               = var.enable_mp_import ? 1 : 0
  alarm_name          = "piggy-import-mercadopago-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "Mercado Pago import failed (see import_status in the app, or the Lambda logs)"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.import_mercadopago[0].function_name
  }

  alarm_actions = [aws_sns_topic.lambda_alerts.arn]
}

# --- Santander: Gmail forwards alerts -> SES inbound -> S3 -> Lambda ----------------------

resource "aws_s3_bucket" "inbound_mail" {
  count  = var.enable_santander_import ? 1 : 0
  bucket = "${var.project_name}-inbound-mail-${random_id.suffix.hex}"
}

resource "aws_s3_bucket_public_access_block" "inbound_mail" {
  count                   = var.enable_santander_import ? 1 : 0
  bucket                  = aws_s3_bucket.inbound_mail[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "inbound_mail" {
  count  = var.enable_santander_import ? 1 : 0
  bucket = aws_s3_bucket.inbound_mail[0].id

  rule {
    id     = "expire_inbound_mail"
    status = "Enabled"

    filter {}

    expiration {
      days = 30
    }
  }
}

resource "aws_s3_bucket_policy" "inbound_mail" {
  count  = var.enable_santander_import ? 1 : 0
  bucket = aws_s3_bucket.inbound_mail[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowSESPuts"
      Effect    = "Allow"
      Principal = { Service = "ses.amazonaws.com" }
      Action    = "s3:PutObject"
      Resource  = "${aws_s3_bucket.inbound_mail[0].arn}/*"
      Condition = {
        StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id }
      }
    }]
  })
}

# SES allows one active receipt rule set per region. If the account already has one (managed
# elsewhere), set existing_ses_rule_set_name and the rule is added to that set instead.
resource "aws_ses_receipt_rule_set" "piggy" {
  count         = var.enable_santander_import && var.existing_ses_rule_set_name == "" ? 1 : 0
  rule_set_name = "piggy-inbound"
}

resource "aws_ses_active_receipt_rule_set" "piggy" {
  count         = var.enable_santander_import && var.existing_ses_rule_set_name == "" ? 1 : 0
  rule_set_name = aws_ses_receipt_rule_set.piggy[0].rule_set_name
}

resource "aws_ses_receipt_rule" "santander" {
  count         = var.enable_santander_import ? 1 : 0
  name          = "piggy-santander-alerts"
  rule_set_name = local.ses_rule_set
  recipients    = [var.inbound_address]
  enabled       = true
  scan_enabled  = true

  s3_action {
    bucket_name       = aws_s3_bucket.inbound_mail[0].id
    object_key_prefix = "santander/"
    position          = 1
  }

  depends_on = [aws_s3_bucket_policy.inbound_mail, aws_ses_receipt_rule_set.piggy]
}

resource "aws_iam_role_policy" "importer_read_mail" {
  count = var.enable_santander_import ? 1 : 0
  name  = "read_inbound_mail"
  role  = aws_iam_role.importer[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:GetObject"]
      Resource = "${aws_s3_bucket.inbound_mail[0].arn}/santander/*"
    }]
  })
}

resource "aws_lambda_function" "import_santander" {
  count            = var.enable_santander_import ? 1 : 0
  filename         = "${local.importer_dir}/package.zip"
  function_name    = "piggy_import_santander"
  role             = aws_iam_role.importer[0].arn
  handler          = "lambda_function.handler"
  runtime          = "python3.11"
  source_code_hash = local.importer_hash
  timeout          = 30
  memory_size      = 128

  environment {
    variables = {
      IMPORT_SOURCE    = "santander"
      SUPABASE_DB_URL  = var.supabase_db_url
      PIGGY_USER_ID    = var.piggy_user_id
      SANTANDER_SENDER = var.santander_sender
      FORWARDING_GMAIL = var.forwarding_gmail
    }
  }

  depends_on = [null_resource.build_importer_lambda]
}

resource "aws_lambda_permission" "import_santander_s3" {
  count         = var.enable_santander_import ? 1 : 0
  statement_id  = "AllowExecutionFromS3InboundMail"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.import_santander[0].function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.inbound_mail[0].arn
}

resource "aws_s3_bucket_notification" "inbound_mail" {
  count  = var.enable_santander_import ? 1 : 0
  bucket = aws_s3_bucket.inbound_mail[0].id

  lambda_function {
    lambda_function_arn = aws_lambda_function.import_santander[0].arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = "santander/"
  }

  depends_on = [aws_lambda_permission.import_santander_s3]
}

resource "aws_cloudwatch_metric_alarm" "import_santander_errors" {
  count               = var.enable_santander_import ? 1 : 0
  alarm_name          = "piggy-import-santander-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "Santander email import failed (see import_status in the app, or the Lambda logs)"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.import_santander[0].function_name
  }

  alarm_actions = [aws_sns_topic.lambda_alerts.arn]
}
