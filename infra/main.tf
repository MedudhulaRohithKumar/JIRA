# =============================================================================
# CSR Work Flow Manager — Terraform Infrastructure (Zero Internet Exposure VPC)
# Provisions:
#   1. Isolated Private VPC + Private Subnets (No Internet Gateway / No Public IP)
#   2. VPC Gateway Endpoint for S3 + Interface Endpoints for API Gateway, SES, KMS, Logs
#   3. KMS Key + S3 Document DB Bucket (Versioning, SSE-KMS, VPC-Endpoint-Only Bucket Policy)
#   4. AWS Lambda Function (FastAPI + Mangum) inside Private Subnets
#   5. Private API Gateway (Resource Policy locked to VPC Endpoint)
#   6. AWS EventBridge Rule at 8:00 PM IST (`cron(30 14 * * ? *)`) for NA Daily Status Email
# =============================================================================

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

variable "aws_region" {
  type    = string
  default = "ap-south-1"
}

variable "vpc_cidr" {
  type    = string
  default = "10.42.0.0/16"
}

variable "admin_report_emails" {
  type    = string
  default = "manager@internal.csr.local,admin@internal.csr.local"
}

variable "ses_sender_email" {
  type    = string
  default = "csr-workflow-noreply@internal.csr.local"
}

variable "jwt_secret_key" {
  type      = string
  sensitive = true
}

provider "aws" {
  region = var.aws_region
}

data "aws_caller_identity" "current" {}

# 1. Private VPC (Zero Public Subnets / Zero Internet Gateway)
resource "aws_vpc" "csr_internal_vpc" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags = {
    Name = "csr-workflow-private-vpc"
  }
}

resource "aws_subnet" "private_a" {
  vpc_id                  = aws_vpc.csr_internal_vpc.id
  cidr_block              = "10.42.1.0/24"
  availability_zone       = "${var.aws_region}a"
  map_public_ip_on_launch = false
  tags                    = { Name = "csr-private-subnet-a" }
}

resource "aws_subnet" "private_b" {
  vpc_id                  = aws_vpc.csr_internal_vpc.id
  cidr_block              = "10.42.2.0/24"
  availability_zone       = "${var.aws_region}b"
  map_public_ip_on_launch = false
  tags                    = { Name = "csr-private-subnet-b" }
}

resource "aws_route_table" "private_rt" {
  vpc_id = aws_vpc.csr_internal_vpc.id
  tags   = { Name = "csr-private-rt" }
}

resource "aws_route_table_association" "a" {
  subnet_id      = aws_subnet.private_a.id
  route_table_id = aws_route_table.private_rt.id
}

resource "aws_route_table_association" "b" {
  subnet_id      = aws_subnet.private_b.id
  route_table_id = aws_route_table.private_rt.id
}

# 2. VPC Endpoints (S3 Gateway Endpoint + API Gateway Interface Endpoint)
resource "aws_vpc_endpoint" "s3_gateway" {
  vpc_id            = aws_vpc.csr_internal_vpc.id
  service_name      = "com.amazonaws.${var.aws_region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.private_rt.id]
  tags              = { Name = "csr-s3-vpce" }
}

resource "aws_security_group" "vpce_sg" {
  name        = "csr-vpce-sg"
  description = "Allow internal VPC HTTPS traffic to Interface Endpoints"
  vpc_id      = aws_vpc.csr_internal_vpc.id

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }
}

resource "aws_vpc_endpoint" "execute_api" {
  vpc_id              = aws_vpc.csr_internal_vpc.id
  service_name        = "com.amazonaws.${var.aws_region}.execute-api"
  vpc_endpoint_type   = "Interface"
  private_dns_enabled = true
  subnet_ids          = [aws_subnet.private_a.id, aws_subnet.private_b.id]
  security_group_ids  = [aws_security_group.vpce_sg.id]
  tags                = { Name = "csr-execute-api-vpce" }
}

# 3. KMS Key & S3 Document DB Bucket
resource "aws_kms_key" "docdb_kms" {
  description             = "CSR Work Flow Manager S3 Document DB KMS Key"
  deletion_window_in_days = 30
  enable_key_rotation     = true
}

resource "aws_s3_bucket" "docdb" {
  bucket = "csr-workflow-docdb-${data.aws_caller_identity.current.account_id}-${var.aws_region}"
}

resource "aws_s3_bucket_public_access_block" "docdb_block_public" {
  bucket                  = aws_s3_bucket.docdb.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "docdb_versioning" {
  bucket = aws_s3_bucket.docdb.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "docdb_sse" {
  bucket = aws_s3_bucket.docdb.id
  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.docdb_kms.arn
      sse_algorithm     = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_policy" "docdb_vpc_only_policy" {
  bucket = aws_s3_bucket.docdb.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyNonTLS"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.docdb.arn, "${aws_s3_bucket.docdb.arn}/*"]
        Condition = {
          Bool = { "aws:SecureTransport" = "false" }
        }
      },
      {
        Sid       = "DenyOutsidePrivateVpcS3Endpoint"
        Effect    = "Deny"
        Principal = "*"
        Action    = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
        Resource  = [aws_s3_bucket.docdb.arn, "${aws_s3_bucket.docdb.arn}/*"]
        Condition = {
          StringNotEquals = { "aws:SourceVpce" = aws_vpc_endpoint.s3_gateway.id }
        }
      }
    ]
  })
}

# 4. EventBridge 8:00 PM IST Daily Status Cutoff Schedule
resource "aws_cloudwatch_event_rule" "daily_8pm_cutoff" {
  name                = "csr-workflow-8pm-daily-status-cutoff"
  description         = "Triggers at 8:00 PM IST (14:30 UTC) daily to lock status and email NA report"
  schedule_expression = "cron(30 14 * * ? *)"
}
