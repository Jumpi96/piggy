resource "aws_iam_role" "lambda_exec" {
  name = "piggy_backup_lambda_role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_policy" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "s3_access" {
  name = "s3_backup_access"
  role = aws_iam_role.lambda_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = [
        "s3:PutObject",
        "s3:ListBucket",
        "s3:DeleteObject"
      ]
      Effect   = "Allow"
      Resource = [
        aws_s3_bucket.backups.arn,
        "${aws_s3_bucket.backups.arn}/*"
      ]
    }]
  })
}

# Backup Lambda
resource "null_resource" "install_backup_deps" {
  triggers = {
    requirements = filemd5("${path.module}/lambdas/backup/requirements.txt")
    lambda_code  = filemd5("${path.module}/lambdas/backup/lambda_function.py")
  }

  provisioner "local-exec" {
    command = <<EOF
      cd ${path.module}/lambdas/backup
      rm -rf package
      mkdir -p package
      pip install -r requirements.txt -t package/ --platform manylinux2014_x86_64 --only-binary=:all: --python-version 3.11
      cp lambda_function.py package/
    EOF
  }
}

data "archive_file" "backup_lambda_zip" {
  type        = "zip"
  source_dir  = "${path.module}/lambdas/backup/package"
  output_path = "${path.module}/backup_lambda.zip"
  depends_on  = [null_resource.install_backup_deps]
}

resource "aws_lambda_function" "backup" {
  filename         = data.archive_file.backup_lambda_zip.output_path
  function_name    = "piggy_db_backup"
  role             = aws_iam_role.lambda_exec.arn
  handler          = "lambda_function.handler"
  runtime          = "python3.11"
  source_code_hash = data.archive_file.backup_lambda_zip.output_base64sha256
  timeout          = 300
  memory_size      = 512

  environment {
    variables = {
      SUPABASE_DB_URL = var.supabase_db_url
      BACKUP_BUCKET   = aws_s3_bucket.backups.bucket
    }
  }
}

# Recurring Generator Lambda
resource "aws_iam_role" "recurring_lambda_exec" {
  name = "piggy_recurring_lambda_role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "recurring_lambda_policy" {
  role       = aws_iam_role.recurring_lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "null_resource" "install_recurring_deps" {
  triggers = {
    requirements = filemd5("${path.module}/lambdas/recurring_generator/requirements.txt")
    lambda_code  = filemd5("${path.module}/lambdas/recurring_generator/lambda_function.py")
  }

  provisioner "local-exec" {
    command = <<EOF
      cd ${path.module}/lambdas/recurring_generator
      rm -rf package
      mkdir -p package
      pip install -r requirements.txt -t package/ --platform manylinux2014_x86_64 --only-binary=:all: --python-version 3.11
      cp lambda_function.py package/
    EOF
  }
}

data "archive_file" "recurring_lambda_zip" {
  type        = "zip"
  source_dir  = "${path.module}/lambdas/recurring_generator/package"
  output_path = "${path.module}/recurring_lambda.zip"
  depends_on  = [null_resource.install_recurring_deps]
}

resource "aws_lambda_function" "recurring_generator" {
  filename         = data.archive_file.recurring_lambda_zip.output_path
  function_name    = "piggy_recurring_generator"
  role             = aws_iam_role.recurring_lambda_exec.arn
  handler          = "lambda_function.handler"
  runtime          = "python3.11"
  source_code_hash = data.archive_file.recurring_lambda_zip.output_base64sha256
  timeout          = 300
  memory_size      = 256

  environment {
    variables = {
      SUPABASE_DB_URL = var.supabase_db_url
    }
  }
}
