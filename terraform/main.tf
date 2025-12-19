terraform {
  required_version = ">= 1.0"

  backend "s3" {
    bucket         = "piggy-terraform-state"
    key            = "piggy/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "piggy-terraform-locks"
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}
