variable "aws_region" {
  description = "AWS Region"
  default     = "us-east-1"
}

variable "project_name" {
  default = "piggy-finance"
}

variable "supabase_db_url" {
  description = "Connection string for Supabase DB"
  type        = string
  sensitive   = true
}

variable "alert_email" {
  description = "Email address to receive lambda failure alerts"
  type        = string
}

# --- Importers (see importer.tf) ---------------------------------------------------------

variable "enable_mp_import" {
  description = "Deploy the daily Mercado Pago importer"
  type        = bool
  default     = false
}

variable "enable_santander_import" {
  description = "Deploy the Santander alert-email importer (SES inbound)"
  type        = bool
  default     = false
}

variable "piggy_user_id" {
  description = "Supabase auth user id the imported entries belong to"
  type        = string
  default     = ""
}

variable "mp_access_token" {
  description = "Mercado Pago access token (from your own MP developer app)"
  type        = string
  default     = ""
  sensitive   = true
}

variable "inbound_address" {
  description = "Address SES receives Santander alerts on, e.g. santander-<random>@in.example.com"
  type        = string
  default     = ""
  sensitive   = true
}

variable "santander_sender" {
  description = "Comma-separated Santander alert senders (addresses or domains), e.g. santander.com.ar"
  type        = string
  default     = "santander.com.ar"
}

variable "forwarding_gmail" {
  description = "Gmail address that forwards the alerts (only mail forwarded by it is accepted)"
  type        = string
  default     = ""
  sensitive   = true
}

variable "existing_ses_rule_set_name" {
  description = "Name of an already-active SES receipt rule set to add the rule to. Empty: create and activate piggy-inbound."
  type        = string
  default     = ""
}
