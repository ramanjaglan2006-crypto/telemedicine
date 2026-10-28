terraform {
  required_version = ">= 1.5.0"
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

# 1. KMS Key for Sensitive Health Information Encryption
resource "aws_kms_key" "amrutam_phi_key" {
  description             = "KMS Key for Amrutam Telemedicine PHI Field-Level Encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  tags = {
    Environment = var.environment
    Compliance  = "HIPAA-Aligned"
  }
}

# 2. VPC & Subnets
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name        = "amrutam-vpc-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_subnet" "public_1" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.1.0/24"
  availability_zone = "${var.aws_region}a"
}

resource "aws_subnet" "public_2" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.2.0/24"
  availability_zone = "${var.aws_region}b"
}

# 3. RDS PostgreSQL 16 Multi-AZ Cluster
resource "aws_db_subnet_group" "rds" {
  name       = "amrutam-rds-subnet-group"
  subnet_ids = [aws_subnet.public_1.id, aws_subnet.public_2.id]
}

resource "aws_db_instance" "postgres" {
  identifier             = "amrutam-telemed-db"
  engine                 = "postgres"
  engine_version         = "16.1"
  instance_class         = var.db_instance_class
  allocated_storage      = 50
  max_allocated_storage  = 500
  storage_type           = "gp3"
  multi_az               = true
  db_name                = "amrutam_telemed"
  username               = "amrutam_admin"
  password               = var.db_password
  db_subnet_group_name   = aws_db_subnet_group.rds.name
  skip_final_snapshot    = true
  deletion_protection    = true
  storage_encrypted      = true
  kms_key_id             = aws_kms_key.amrutam_phi_key.arn
  backup_retention_period = 30

  tags = {
    Environment = var.environment
  }
}

# 4. ElastiCache Redis Cluster (Multi-AZ)
resource "aws_elasticache_subnet_group" "redis" {
  name       = "amrutam-redis-subnets"
  subnet_ids = [aws_subnet.public_1.id, aws_subnet.public_2.id]
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id       = "amrutam-redis-cluster"
  description                = "Amrutam Redis Cluster for Cache & Rate Limiting"
  node_type                  = "cache.t4g.medium"
  num_cache_clusters         = 2
  automatic_failover_enabled = true
  subnet_group_name          = aws_elasticache_subnet_group.redis.name
  port                       = 6379
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
}

# 5. ECS Fargate Cluster & Application Load Balancer
resource "aws_ecs_cluster" "main" {
  name = "amrutam-cluster-${var.environment}"
}

resource "aws_cloudwatch_log_group" "ecs" {
  name              = "/ecs/amrutam-telemed-backend"
  retention_in_days = 90
}
