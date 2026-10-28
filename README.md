# Amrutam Telemedicine Backend

[![CI Pipeline](https://github.com/amrutam/telemedicine-backend/actions/workflows/ci.yml/badge.svg)](https://github.com/amrutam/telemedicine-backend/actions)
![Node.js](https://img.shields.io/badge/Node.js-24.x-green.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)
![PostgreSQL](https://img.shields.io/badge/Database-PostgreSQL%2016-blue.svg)
![Tests](https://img.shields.io/badge/Tests-26%20Passing-brightgreen.svg)

Production-grade, highly available, secure, and observable backend for Amrutam's Ayurvedic Telemedicine Platform. Built to support 100,000+ daily consultations, concurrent doctor bookings with atomic double-booking prevention, immutable prescriptions, TOTP multi-factor authentication, and strict object-level tenant authorization.

---

## 🏛️ System Architecture

* **Architecture Pattern:** Modular Monolith (Express.js + TypeScript Strict Mode)
* **Primary Database:** PostgreSQL 16 (with connection pooling, ACID transaction boundaries, and row-level locks)
* **Idempotency Engine:** Durable SHA-256 canonical request fingerprinting with database locking & replay cache
* **Security & Cryptography:** 
  * Argon2id / Bcrypt password hashing (12 rounds)
  * Short-lived JWT Access Tokens (15m) + Refresh Token rotation and replay revocation
  * Time-based One-Time Password (TOTP RFC 6238) MFA with QR code onboarding
  * Authenticated **AES-256-GCM** field-level encryption for sensitive health information (PHI)
  * Timing-safe HMAC-SHA256 signature verification for payment webhooks
* **Asynchronous Resilience:** Transactional Outbox Pattern for reliable notification delivery
* **Observability:** Structured JSON logging with automated credential/PHI redaction, Prometheus metrics exporter (`/metrics`), and health probes (`/health/live`, `/health/ready`).

---

## 🚀 Quick Start Guide

### 1. Prerequisites
* **Node.js:** v20.x or v24.x
* **npm:** v10+
* **Docker & Docker Compose** (for containerized deployment)

### 2. Local Installation
```bash
# 1. Clone repository & install dependencies
git clone <repo-url> amrutam-backend
cd amrutam-backend
npm install

# 2. Configure environment
cp .env.example .env

# 3. Seed test database records (Admin, Doctors, Patients, Slots)
npm run seed

# 4. Start development server with live reload
npm run dev
```
The server will start at `http://localhost:3000`.

### 3. Docker Compose Local Deployment
To run the full stack (Application + PostgreSQL 16 + Redis 7 + Prometheus):
```bash
docker compose up -d
```

---

## 🧪 Automated Testing Suite

All tests execute hermetically without external host dependencies:
```bash
# Run complete test suite (Unit, Integration, Security Anti-IDOR, Concurrency)
npm test

# Run test suite with code coverage report
npm run test:coverage

# Run TypeScript typechecking and static linting
npm run lint
```

### Key Tested Scenarios:
1. **Concurrent Double-Booking Prevention (`tests/concurrency/double_booking.test.ts`):**  
   Two simultaneous booking requests targeting the exact same slot &rarr; Exactly ONE succeeds (HTTP 201), the other is rejected with HTTP 409 Conflict.
2. **Idempotency Safe Replay:**  
   Sending duplicate requests with the same `Idempotency-Key` returns the cached response with `X-Idempotent-Replay: true` without duplicate record creation.
3. **Idempotency Mismatched Payload:**  
   Reusing an idempotency key with a altered payload body is rejected with HTTP 422 Unprocessable Entity.
4. **Anti-IDOR / Tenancy Security (`tests/security/idor.test.ts`):**  
   Cross-patient appointment/prescription snooping rejected with HTTP 403 Forbidden. Cross-doctor consultation completion rejected. Non-admin access to `/api/v1/admin/*` rejected.

---

## 📡 API Endpoints Overview

| Method | Endpoint | Description | Auth / Security |
| :--- | :--- | :--- | :--- |
| `GET` | `/health/live` | Process liveness probe | Public |
| `GET` | `/health/ready` | Database readiness probe | Public |
| `GET` | `/metrics` | Prometheus metrics scrape target | Public |
| `GET` | `/api/docs/openapi.json`| OpenAPI 3.1 Specification | Public |
| `POST` | `/api/v1/auth/register` | Register user (Patient, Doctor, Admin) | Public (Rate Limited) |
| `POST` | `/api/v1/auth/login` | Authenticate user & check MFA | Public (Rate Limited) |
| `POST` | `/api/v1/auth/refresh` | Rotate refresh tokens | Public |
| `POST` | `/api/v1/auth/mfa/enroll` | Generate TOTP secret & QR data URL | Bearer Auth |
| `POST` | `/api/v1/auth/mfa/verify` | Verify OTP code and enable MFA | Bearer Auth |
| `GET` | `/api/v1/users/me` | Get own profile & decrypted medical history | Bearer Auth |
| `GET` | `/api/v1/doctors` | Search verified doctors with filters | Public |
| `GET` | `/api/v1/availability/doctors/:doctorId` | View doctor's available slots | Public |
| `POST` | `/api/v1/availability/me` | Doctor publishes availability slots | DOCTOR only |
| `POST` | `/api/v1/appointments` | **Atomic double-booking protected booking** | PATIENT only + Idempotent |
| `POST` | `/api/v1/appointments/:id/cancel` | Cancel appointment & release slot | Tenant Auth (Anti-IDOR) |
| `POST` | `/api/v1/consultations/:id/start` | Start consultation (SCHEDULED &rarr; IN_PROGRESS)| DOCTOR only |
| `POST` | `/api/v1/consultations/:id/complete`| Complete consultation with clinical notes | DOCTOR only |
| `POST` | `/api/v1/prescriptions/consultations/:id/prescriptions` | Issue immutable prescription | DOCTOR only + Idempotent |
| `POST` | `/api/v1/payments` | Create payment intent for appointment | PATIENT only + Idempotent |
| `POST` | `/api/v1/payments/webhooks/:provider` | Idempotent payment webhook | HMAC-SHA256 Signature |
| `GET` | `/api/v1/admin/analytics/overview` | Platform overview & utilization rates | ADMIN only |

---

## 📚 Deliverables & Documentation Index

* **Architecture Document:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (High-level architecture, booking sequence diagram, ER diagram, capacity model, DR strategy)
* **OpenAPI 3.1 Specification:** [`docs/openapi.json`](docs/openapi.json)
* **STRIDE Threat Model:** [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md)
* **Security & Compliance Checklist:** [`docs/SECURITY_CHECKLIST.md`](docs/SECURITY_CHECKLIST.md)
* **Backup & Disaster Recovery Strategy:** [`docs/BACKUP_AND_DR.md`](docs/BACKUP_AND_DR.md)
* **5-Minute Technical Demo Script:** [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md)
* **Database DDL Schema:** [`src/infrastructure/database/schema.sql`](src/infrastructure/database/schema.sql)
* **Docker Multi-Stage Build:** [`Dockerfile`](Dockerfile) & [`docker-compose.yml`](docker-compose.yml)
* **CI/CD Pipeline:** [`.github/workflows/ci.yml`](.github/workflows/ci.yml)
