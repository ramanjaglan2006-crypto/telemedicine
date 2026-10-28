-- ==============================================================================
-- PostgreSQL Range Partitioning Strategy for High-Scale Volume
-- Demonstrates monthly declarative range partitioning for 100k daily consultations
-- Target Tables: audit_logs (compliance trails) and consultations (clinical encounters)
-- ==============================================================================

-- 1. Partitioned Audit Logs Table (Range by created_at)
CREATE TABLE IF NOT EXISTS audit_logs_partitioned (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    user_id UUID NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id VARCHAR(100) NULL,
    metadata_json TEXT NULL,
    ip_address VARCHAR(50) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Partitions for 2026 Monthly Slices
CREATE TABLE IF NOT EXISTS audit_logs_2026_10 PARTITION OF audit_logs_partitioned
    FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00');

CREATE TABLE IF NOT EXISTS audit_logs_2026_11 PARTITION OF audit_logs_partitioned
    FOR VALUES FROM ('2026-11-01 00:00:00+00') TO ('2026-12-01 00:00:00+00');

CREATE TABLE IF NOT EXISTS audit_logs_2026_12 PARTITION OF audit_logs_partitioned
    FOR VALUES FROM ('2026-12-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');

-- 2. Partitioned Consultations Table (Range by created_at)
CREATE TABLE IF NOT EXISTS consultations_partitioned (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    appointment_id UUID NOT NULL,
    patient_id UUID NOT NULL,
    doctor_id UUID NOT NULL,
    status VARCHAR(20) NOT NULL,
    clinical_notes_encrypted TEXT NULL,
    started_at TIMESTAMPTZ NULL,
    completed_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Partitions for 2026 Monthly Slices
CREATE TABLE IF NOT EXISTS consultations_2026_10 PARTITION OF consultations_partitioned
    FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00');

CREATE TABLE IF NOT EXISTS consultations_2026_11 PARTITION OF consultations_partitioned
    FOR VALUES FROM ('2026-11-01 00:00:00+00') TO ('2026-12-01 00:00:00+00');

CREATE TABLE IF NOT EXISTS consultations_2026_12 PARTITION OF consultations_partitioned
    FOR VALUES FROM ('2026-12-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');

-- Automated pg_partman or cron retention policy documentation:
-- To drop partitions older than 7 years (statutory medical record retention requirement):
-- DROP TABLE IF EXISTS audit_logs_2019_10;
