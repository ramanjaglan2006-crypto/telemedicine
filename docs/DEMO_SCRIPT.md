# Amrutam Telemedicine Backend — 5-Minute Technical Demonstration Script

This script guides the evaluation team through demonstrating the backend architecture, concurrent double-booking protection, idempotency, and clinical workflows in under five minutes.

---

## Minute 0:00 - 0:45 | Architecture & System Verification
1. **Show Directory Structure & Architecture:**
   * Showcase modular monolith architecture (`src/modules`, `src/common`, `src/infrastructure`).
2. **Run Automated Test Suite:**
   ```bash
   npm test
   ```
   * *Highlight:* 26 passing tests across unit, integration, anti-IDOR security, and concurrency.

---

## Minute 0:45 - 1:45 | Authentication, Identity & Multi-Factor Auth (MFA)
1. **Register Patient & Doctor:**
   ```bash
   # Register Patient
   curl -X POST http://localhost:3000/api/v1/auth/register \
     -H "Content-Type: application/json" \
     -d '{"email":"demo.patient@amrutam.com","password":"Password123!","role":"PATIENT","firstName":"Demo","lastName":"Patient"}'
   ```
2. **Enroll TOTP Multi-Factor Authentication:**
   * Demonstrate QR code data URL generation and RFC 6238 TOTP verification with drift tolerance.

---

## Minute 1:45 - 2:45 | Concurrent Booking & Double-Booking Protection
1. **The Core Engineering Challenge:**
   * Explain how two patients racing to book the same doctor slot are handled.
2. **Execute Concurrency Test:**
   ```bash
   npm test tests/concurrency/double_booking.test.ts
   ```
   * *Demonstrate:* Using `SELECT ... FOR UPDATE` and database unique constraints, exactly ONE request receives `HTTP 201 Created` while the other receives `HTTP 409 Conflict`. Zero duplicate bookings occur.

---

## Minute 2:45 - 3:30 | Non-Repeatable Idempotency Engine
1. **Demonstrate Replay Cache:**
   * Show `Idempotency-Key` header with SHA-256 canonical request fingerprinting.
   * Sending duplicate request returns `X-Idempotent-Replay: true` with cached status code without executing business logic twice.
   * Modifying payload with same key returns `HTTP 422 Unprocessable Entity`.

---

## Minute 3:30 - 4:15 | Consultation & Immutable Prescription Lifecycle
1. **Start & Complete Consultation:**
   * Doctor transitions status (`SCHEDULED` &rarr; `IN_PROGRESS` &rarr; `COMPLETED`) with AES-256-GCM encrypted clinical notes.
2. **Issue Immutable Prescription:**
   * Prescriber authorization check enforces that only the assigned doctor can issue prescriptions.
   * Medications and diagnoses are encrypted at rest with version numbers incremented automatically.

---

## Minute 4:15 - 5:00 | Observability, Metrics & Docker Deployment
1. **Inspect Prometheus Metrics:**
   ```bash
   curl http://localhost:3000/metrics | grep amrutam_
   ```
   * Show `amrutam_http_requests_total`, `amrutam_booking_operations_total`, and `amrutam_idempotency_hits_total`.
2. **Health Checks:**
   ```bash
   curl http://localhost:3000/health/live
   curl http://localhost:3000/health/ready
   ```
3. **Docker Compose Launch:**
   ```bash
   docker compose up -d
   ```
