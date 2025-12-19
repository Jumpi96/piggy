# Piggy Finance Infrastructure

This directory contains Terraform configuration for deploying AWS infrastructure for Piggy Finance, including:

- **Database Backup Lambda**: Weekly backups to S3 with 30-day retention
- **Recurring Transaction Generator Lambda**: Monthly generation of recurring transactions

## Prerequisites

1. AWS CLI configured with credentials
2. Terraform >= 1.0 installed
3. Python 3.11 installed (for lambda dependencies)

## Architecture

### Backup Lambda
- **Trigger**: Weekly (every 7 days)
- **Function**: Creates PostgreSQL dump and uploads to S3
- **Retention**: 30 days (managed by S3 lifecycle policy + lambda cleanup)
- **Runtime**: Python 3.11

### Recurring Generator Lambda
- **Trigger**: Monthly (1st day of month at 2 AM UTC)
- **Function**: Calls `ensure_recurring_generated` RPC with 24-month horizon
- **Runtime**: Python 3.11

## Deployment via GitHub Actions

The infrastructure is automatically deployed when changes are pushed to the `main` branch:

1. Frontend is built and deployed to GitHub Pages
2. Terraform configuration is applied to AWS

## Updating Lambda Code

When updating lambda code:

1. Modify files in `lambdas/backup/` or `lambdas/recurring_generator/`
2. Push to `main` branch
3. GitHub Actions will automatically rebuild and deploy

## Manual Lambda Invocation

To test lambdas manually:

```bash
# Test backup lambda
aws lambda invoke \
  --function-name piggy_db_backup \
  --region us-east-1 \
  response.json

# Test recurring generator lambda
aws lambda invoke \
  --function-name piggy_recurring_generator \
  --region us-east-1 \
  response.json
```

## Troubleshooting

### Lambda Errors

Check CloudWatch Logs:
```bash
aws logs tail /aws/lambda/piggy_db_backup --follow
aws logs tail /aws/lambda/piggy_recurring_generator --follow
```

### State Lock Issues

If Terraform state gets locked:
```bash
# List locks
aws dynamodb scan --table-name piggy-terraform-locks

# Remove a specific lock (use LockID from above)
aws dynamodb delete-item \
  --table-name piggy-terraform-locks \
  --key '{"LockID": {"S": "piggy-terraform-state/piggy/terraform.tfstate"}}'
```

## Cleanup

To destroy all infrastructure:

```bash
cd terraform
terraform destroy -var="supabase_db_url=postgresql://..."
```

Note: This will NOT delete the Terraform state bucket and DynamoDB table (they must be deleted manually if needed).
