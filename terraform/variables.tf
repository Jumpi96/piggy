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
