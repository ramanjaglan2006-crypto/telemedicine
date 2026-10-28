# Amrutam Telemedicine Backend — Security Checklist & Compliance Matrix

| Control Identifier | Security Control Requirement | Implementation Location | Verification Evidence | Status |
| :--- | :--- | :--- | :--- | :--- |
| **SEC-AUTH-01** | Passwords must be hashed using a strong, salted slow hashing algorithm (Argon2id/Bcrypt >= 12 rounds). Never plaintext. | `src/common/security/crypto.ts` | `tests/unit/security.test.ts` | **PASS** |
| **SEC-AUTH-02** | Short-lived Access Tokens (15m) and Refresh Token rotation with replay detection. | `src/common/security/jwt.ts`, `src/modules/auth/auth.service.ts` | `tests/unit/security.test.ts` | **PASS** |
| **SEC-AUTH-03** | Multi-Factor Authentication (TOTP RFC 6238) with QR code onboarding and drift tolerance. | `src/common/security/mfa.ts` | `tests/unit/security.test.ts` | **PASS** |
| **SEC-AUTH-04** | Role-Based Access Control enforcing least privilege (`PATIENT`, `DOCTOR`, `ADMIN`). | `src/common/middleware/auth.ts` | `tests/security/idor.test.ts` | **PASS** |
| **SEC-AUTH-05** | Broken Object-Level Authorization (Anti-IDOR) resource ownership validation. | `src/modules/appointments/appointments.service.ts` | `tests/security/idor.test.ts` | **PASS** |
| **SEC-CRYP-01** | Field-level authenticated encryption (AES-256-GCM) with 96-bit random IVs for sensitive clinical data. | `src/common/security/crypto.ts` | `tests/unit/security.test.ts` | **PASS** |
| **SEC-CRYP-02** | Timing-safe HMAC-SHA256 signature verification for external webhooks. | `src/common/security/crypto.ts` | `tests/integration/api.test.ts` | **PASS** |
| **SEC-CONC-01** | Atomic double-booking prevention under concurrent load with database unique constraints and row locks. | `src/modules/appointments/appointments.service.ts` | `tests/concurrency/double_booking.test.ts` | **PASS** |
| **SEC-IDEM-01** | Non-repeatable write idempotency with canonical SHA-256 fingerprinting and replay cache. | `src/common/idempotency/idempotency.manager.ts` | `tests/concurrency/double_booking.test.ts` | **PASS** |
| **SEC-INPT-01** | Strict request schema validation (Zod) rejecting malformed inputs before controller invocation. | `src/common/middleware/validate.ts` | `tests/integration/api.test.ts` | **PASS** |
| **SEC-NETW-01** | HTTP Security Headers (CSP, HSTS, X-Content-Type-Options, Frameguard) via Helmet. | `src/app.ts` | Code inspection | **PASS** |
| **SEC-RATE-01** | Rate limiting on authentication and sensitive endpoints with `Retry-After` headers. | `src/common/middleware/rateLimit.ts` | `tests/unit/security.test.ts` | **PASS** |
| **SEC-OBSV-01** | Structured JSON logging with automatic PII/credential redaction. | `src/common/observability/logger.ts` | Code inspection | **PASS** |
| **SEC-CONT-01** | Non-root container execution (`node` user) in multi-stage Docker build. | `Dockerfile` | Multi-stage Docker inspection | **PASS** |
