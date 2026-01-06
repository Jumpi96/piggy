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
      Effect = "Allow"
      Resource = [
        aws_s3_bucket.backups.arn,
        "${aws_s3_bucket.backups.arn}/*"
      ]
    }]
  })
}

# Backup Lambda - Build package
resource "null_resource" "build_backup_lambda" {
  triggers = {
    requirements = filemd5("${path.module}/lambdas/backup/requirements.txt")
    lambda_code  = filemd5("${path.module}/lambdas/backup/lambda_function.py")
  }

  provisioner "local-exec" {
    command = <<EOF
      set -e
      cd ${path.module}/lambdas/backup
      rm -rf package package.zip
      mkdir -p package
      pip install -r requirements.txt -t package/ --platform manylinux2014_x86_64 --only-binary=:all: --python-version 3.11
      cp lambda_function.py package/
      cd package
      zip -r ../package.zip . -x "*.pyc" -x "__pycache__/*"
    EOF
  }

  provisioner "local-exec" {
    when    = destroy
    command = "rm -f ${path.module}/lambdas/backup/package.zip"
  }
}

resource "aws_lambda_function" "backup" {
  filename         = "${path.module}/lambdas/backup/package.zip"
  function_name    = "piggy_db_backup"
  role             = aws_iam_role.lambda_exec.arn
  handler          = "lambda_function.handler"
  runtime          = "python3.11"
  source_code_hash = null_resource.build_backup_lambda.id
  timeout          = 300
  memory_size      = 512

  environment {
    variables = {
      SUPABASE_DB_URL = var.supabase_db_url
      BACKUP_BUCKET   = aws_s3_bucket.backups.bucket
    }
  }

  depends_on = [null_resource.build_backup_lambda]
}

