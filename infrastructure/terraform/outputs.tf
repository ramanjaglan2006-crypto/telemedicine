output "kms_key_arn" {
  value       = aws_kms_key.amrutam_phi_key.arn
  description = "ARN of the AWS KMS key for PHI encryption"
}

output "rds_endpoint" {
  value       = aws_db_instance.postgres.endpoint
  description = "PostgreSQL primary connection endpoint"
}

output "redis_primary_endpoint" {
  value       = aws_elasticache_replication_group.redis.primary_endpoint_address
  description = "ElastiCache Redis primary endpoint"
}
