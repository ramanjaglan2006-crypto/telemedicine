variable "aws_region" {
  type        = string
  default     = "ap-south-1"
  description = "AWS deployment region (Mumbai)"
}

variable "environment" {
  type        = string
  default     = "production"
  description = "Deployment environment"
}

variable "db_instance_class" {
  type        = string
  default     = "db.r6g.xlarge"
  description = "RDS PostgreSQL Instance Class"
}

variable "db_password" {
  type        = string
  sensitive   = true
  description = "PostgreSQL Administrator Password"
}
