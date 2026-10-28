# Amrutam Telemedicine Backend — Backup and Disaster Recovery (DR) Strategy

**Target Availability:** 99.95% (Downtime $\le 4.38$ hours/year)  
**Target RPO (Recovery Point Objective):** $\le 5$ minutes  
**Target RTO (Recovery Time Objective):** $\le 30$ minutes  

---

## 1. Backup Strategy & Scheduling

| Data Tier | Backup Type | Frequency | Retention | Storage Location | Encryption |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **PostgreSQL Database** | Full Physical Snapshot | Daily at 02:00 UTC | 30 Days | AWS S3 / GCS Glacier (Cross-region) | AES-256 (KMS-managed) |
| **PostgreSQL WAL Logs** | Continuous Archiving | Every 5 Minutes | 7 Days | S3 Bucket with Object Lock | AES-256 (KMS-managed) |
| **Application Config & Secrets** | Versioned GitOps / Secrets Vault | On every deployment | Perpetual (Audit trail) | HashiCorp Vault / AWS Secrets Mgr | Envelope Encryption |

---

## 2. Restoration & Point-in-Time Recovery (PITR) Procedure

### Step-by-Step Restoration Runbook:
1. **Declare Incident & Isolate Ingress:**
   * Divert DNS / Load Balancer traffic to static maintenance page (`503 Service Temporarily Unavailable`).
2. **Provision Target PostgreSQL Instance:**
   * Launch new PostgreSQL 16 container/instance from Terraform or Docker Compose.
3. **Download Base Backup & WAL Archives:**
   ```bash
   aws s3 cp s3://amrutam-backups/latest-base-backup.tar.gz /var/lib/postgresql/data/
   tar -xvf /var/lib/postgresql/data/latest-base-backup.tar.gz -C /var/lib/postgresql/data/
   ```
4. **Configure Recovery Target Time (`recovery.signal`):**
   ```ini
   # postgresql.conf
   restore_command = 'aws s3 cp s3://amrutam-wal-archive/%f %p'
   recovery_target_time = '2026-10-28 06:30:00 UTC'
   recovery_target_action = 'promote'
   ```
5. **Start PostgreSQL & Verify Consistency:**
   ```bash
   pg_ctl start -D /var/lib/postgresql/data/
   psql -U postgres -d amrutam_telemed -c "SELECT COUNT(*) FROM appointments; SELECT COUNT(*) FROM prescriptions;"
   ```
6. **Drain & Process Outbox Events:**
   * Run outbox worker to resolve any pending event notifications.
7. **Switch Ingress Traffic & Validate Health:**
   * Perform curl check against `/health/ready` and restore customer traffic.

---

## 3. Disaster Recovery Drill Schedule
* **Quarterly Restoration Drill:** Restore production snapshot into isolated staging environment; execute Vitest automated test suite against restored database.
* **Failover Validation:** Measure actual RTO time from snapshot restore to successful health check.
