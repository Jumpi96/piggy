# Piggy Finance Infrastructure

This directory contains Terraform configuration for deploying AWS infrastructure for Piggy Finance, including:

- **Database Backup Lambda**: Weekly backups to S3 with 30-day retention

> Note: recurring transactions are generated client-side ("virtual" occurrences in
> `src/lib/recurringUtils.ts`); there is no longer a recurring-generator Lambda or an
> `ensure_recurring_generated` RPC.

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

### Importers (optional, see "Automatic imports" below)
- **`piggy_import_mercadopago`**: daily at 07:00 Argentina time; downloads the Mercado Pago release report.
- **`piggy_import_santander`**: triggered by S3 when SES receives a Santander alert email forwarded by Gmail.
- Both write unconfirmed rows to `import_entries` (the app's Inbox) and their status to the `import_status` parameter.

## Deployment via GitHub Actions

The infrastructure is automatically deployed when changes are pushed to the `main` branch:

1. Frontend is built and deployed to GitHub Pages
2. Terraform configuration is applied to AWS

## Updating Lambda Code

When updating lambda code:

1. Modify files in `lambdas/backup/`
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
```

## Automatic imports

Movements from Mercado Pago and Santander land in the app's **Inbox** as unconfirmed entries; you
add (choosing category and tag) or dismiss each one. Each importer is off until enabled through
GitHub repository **variables** (Settings → Secrets and variables → Actions → Variables) and
**secrets**, which `deploy.yml` passes to Terraform.
`INBOUND_ADDRESS` and `FORWARDING_GMAIL` are secrets, not variables: this repo's Actions logs are
public, and variables are printed in them, which would expose the address.

| Name | Kind | Used by | Value |
|---|---|---|---|
| `PIGGY_USER_ID` | variable | both | Your Supabase auth user id (Authentication → Users) |
| `ENABLE_MP_IMPORT` | variable | MP | `true` |
| `MP_ACCESS_TOKEN` | secret | MP | Production access token of your Mercado Pago app |
| `ENABLE_SANTANDER_IMPORT` | variable | Santander | `true` |
| `INBOUND_ADDRESS` | secret | Santander | e.g. `santander-<random>@in.<yourdomain>` (pick a hard-to-guess local part) |
| `FORWARDING_GMAIL` | secret | Santander | The Gmail address that receives the alerts |
| `SANTANDER_SENDER` | variable | Santander | Alert senders, comma-separated addresses or domains (default `santander.com.ar`) |
| `EXISTING_SES_RULE_SET_NAME` | variable | Santander | Only if another SES receipt rule set is already active in us-east-1 |

### Mercado Pago (one time)

1. Create an application at [Mercado Pago Developers](https://www.mercadopago.com.ar/developers/panel/app) and copy its **production access token** into the `MP_ACCESS_TOKEN` secret. Set `ENABLE_MP_IMPORT=true` and release.
2. Configure and schedule the daily report (idempotent):
   ```bash
   aws lambda invoke --function-name piggy_import_mercadopago \
     --cli-binary-format raw-in-base64-out --payload '{"action":"mp_setup"}' out.json
   ```
3. Optional backfill (the report is generated asynchronously; the next daily run imports it):
   ```bash
   aws lambda invoke --function-name piggy_import_mercadopago \
     --cli-binary-format raw-in-base64-out \
     --payload '{"action":"mp_backfill","begin_date":"2026-10-01","end_date":"2026-10-14"}' out.json
   ```
4. What gets imported (checked against a real account): every payment, tip and transfer out of
   the Mercado Pago balance, including purchases with Mercado Pago's own debit card. Purchases
   are described from the payments API (merchant name). Transfers read "Transferencia enviada",
   because the API doesn't expose the recipient. Interest (`asset_management`) is parsed but off
   by default (Settings → Imports). Incoming money and refunds are never imported. Each run's
   `payment_methods_seen` and `inflow_descriptions` are kept in `import_status.mercadopago`.

### Santander via Gmail forwarding (one time)

Prerequisite (domain repo): an SES identity for the receiving subdomain (e.g. `in.<yourdomain>`)
verified in us-east-1, and an MX record `in.<yourdomain> MX 10 inbound-smtp.us-east-1.amazonaws.com`.

1. Set `ENABLE_SANTANDER_IMPORT=true`, `INBOUND_ADDRESS`, `FORWARDING_GMAIL` (and `PIGGY_USER_ID`) and release.
2. Enable Santander's purchase and transfer email alerts.
3. In Gmail: Settings → Forwarding and POP/IMAP → **Add a forwarding address** → `INBOUND_ADDRESS`.
   Gmail emails a confirmation to that address. Within seconds, the status strip at the top of
   Piggy's **Inbox** shows either a **Confirm Gmail forwarding** button (current emails, at least
   in Spanish, only carry a link) or a code to enter in Gmail. It shows the button only if the
   email passed DMARC for google.com and the link is a `https://mail.google.com/mail/vf-…` one.
4. Create a Gmail filter: `from:(santander.com.ar)` → **Forward it to** `INBOUND_ADDRESS`.

Only mail that Gmail forwarded from `FORWARDING_GMAIL`, whose original sender matches
`SANTANDER_SENDER`, and that SES didn't flag as spam/virus is imported; everything else is logged and
ignored. Emails the parser can't fully read still reach the Inbox marked "needs review". Raw emails
are kept in the `piggy-finance-inbound-mail-*` bucket for 30 days.

Map card references to Piggy credit cards in the app: **Settings → Imports → Card mapping**.

### Testing the importers

```bash
pip install pytest
python -m pytest terraform/lambdas/importer/tests
```

## Troubleshooting

### Lambda Errors

Check CloudWatch Logs:
```bash
aws logs tail /aws/lambda/piggy_db_backup --follow
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
