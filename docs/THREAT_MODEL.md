# Amrutam Telemedicine Backend — Threat Model & Security Analysis

**Methodology:** STRIDE (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege)  
**Standard:** OWASP API Security Top 10 (2023)  
**Classification:** Medical Device / Healthcare Information System  

---

## 1. Asset & Trust Boundary Identification

### Critical Assets:
1. **Protected Health Information (PHI):** Patient medical history, doctor diagnoses, clinical session notes, and prescribed Ayurvedic formulations.
2. **Identity & Authentication Credentials:** User passwords, TOTP MFA secrets, JWT signing keys, and refresh tokens.
3. **Availability & Scheduling State:** Doctor appointment slots, booking reservations, and active consultation rooms.
4. **Financial Transactions:** Payment intent records, Stripe webhook verification secrets, and transaction IDs.
5. **Audit Trails:** Immutable access logs tracking who viewed or modified patient health records.

### Trust Boundaries:
* **Boundary 1 (External Client &rarr; Ingress):** Untrusted public internet to TLS 1.3 reverse proxy.
* **Boundary 2 (Ingress &rarr; Application Controller):** Transport layer to authenticated request context.
* **Boundary 3 (Application &rarr; Database Engine):** Application service layer to PostgreSQL storage tier.
* **Boundary 4 (External Payment Provider &rarr; Webhook Endpoint):** Untrusted external internet to payment webhook controller.

---

## 2. STRIDE Threat Matrix & Implemented Mitigations

| Category | Threat Scenario | Impact | Implemented Mitigation | Verification Method | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Spoofing** | Credential stuffing / Brute force login attacks | Account Takeover | Bcrypt password hashing (12 rounds) + Aggressive rate limiter (10 req/min on `/api/v1/auth/login`) + TOTP Multi-Factor Authentication. | `tests/unit/security.test.ts` | **VERIFIED** |
| **Spoofing** | Fake payment webhook delivery | Unauthorized appointment confirmation | Timing-safe HMAC-SHA256 signature verification (`verifyHmacSignature`) with shared secret. | `tests/integration/api.test.ts` | **VERIFIED** |
| **Tampering** | Altering prescription medication after issuance | Patient safety hazard | Prescriptions table enforces `is_immutable = TRUE`, unique constraint on `(consultation_id, version)`, and AES-256-GCM authenticated encryption. | `tests/integration/api.test.ts` | **VERIFIED** |
| **Tampering** | Replay of requests with modified payloads | Data corruption | Idempotency engine computes SHA-256 canonical request fingerprint; rejects payload modifications with HTTP 422. | `tests/concurrency/double_booking.test.ts` | **VERIFIED** |
| **Repudiation** | Doctor denies issuing a prescription or patient denies cancellation | Legal dispute / Audit failure | Centralized `audit_logs` records user ID, IP address, timestamp, and action metadata for every state change. | `tests/integration/api.test.ts` | **VERIFIED** |
| **Information Disclosure** | Broken Object-Level Authorization (BOLA/IDOR) on appointments or clinical records | Privacy violation / Regulatory penalty | Strict resource-level tenancy check: queries explicitly enforce `patient_id == req.user.userId` or `doctor_id == req.doctor.id`. Returns HTTP 403. | `tests/security/idor.test.ts` | **VERIFIED** |
| **Information Disclosure** | Sensitive health data leak in log pipelines | Unintentional PHI exposure | Field-level redactor in `Logger` automatically masks `password`, `token`, `secret`, `authorization`, and health fields before JSON serialization. | `tests/unit/security.test.ts` | **VERIFIED** |
| **Information Disclosure** | Database theft or snapshot compromise | Mass data leak | Field-level authenticated encryption (AES-256-GCM) for clinical notes, medical history, and prescriptions. Plaintext is unreadable without `ENCRYPTION_KEY`. | `tests/unit/security.test.ts` | **VERIFIED** |
| **Denial of Service** | Concurrent booking burst targeting a single doctor slot | Race conditions / Double bookings | Atomic transaction with row-level locking (`SELECT ... FOR UPDATE`) and database unique constraint on `appointments(slot_id)`. | `tests/concurrency/double_booking.test.ts` | **VERIFIED** |
| **Denial of Service** | API request flooding | Service outage | Sliding-window rate limiter middleware with `X-RateLimit-*` and `Retry-After` headers. | `tests/unit/security.test.ts` | **VERIFIED** |
| **Elevation of Privilege** | Patient attempts to access `/api/v1/admin/*` endpoints | Unauthorized admin access | RBAC middleware (`requireRoles('ADMIN')`) strictly checks verified JWT claims and database active status. | `tests/security/idor.test.ts` | **VERIFIED** |

---

## 3. Residual Risks & Production Hardening Recommendations

1. **Hardware Security Module (HSM) / KMS Integration:**  
   * *Current:* `ENCRYPTION_KEY` is loaded via secure environment variable.  
   * *Production Recommendation:* Delegate AES-256-GCM envelope encryption keys to AWS KMS or HashiCorp Vault with automated 90-day rotation.
2. **Distributed Redis Rate Limiter:**  
   * *Current:* Sliding-window rate limiter stores counters in memory.  
   * *Production Recommendation:* Mount Redis-backed atomic sliding window (`INCR` + `EXPIRE`) for multi-replica cluster deployments.
