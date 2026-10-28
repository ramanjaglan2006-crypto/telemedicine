# Amrutam Telemedicine Backend — Architecture & System Design Document

**Document Version:** 1.0.0  
**Status:** Approved for Technical Evaluation  
**Author:** Principal Backend & System Architecture Team  
**Scope:** Core Telemedicine Platform (Identity, Doctor Availability, Concurrent Booking, Consultations, Prescriptions, Payments, Observability)

---

## 1. Executive Summary & Problem Scope

Amrutam is a high-scale Ayurvedic telemedicine platform connecting patients across geographies with certified Ayurvedic practitioners. The backend system serves as the foundational source of truth for:
* User lifecycle management, Argon2id/bcrypt identity authentication, and Time-based One-Time Password (TOTP) Multi-Factor Authentication.
* Role-Based Access Control (`PATIENT`, `DOCTOR`, `ADMIN`) with strict object-level tenant authorization (Anti-IDOR).
* Timezone-aware doctor availability management and continuous slot generation.
* **Concurrent, double-booking protected appointment scheduling** with atomic database transaction boundaries.
* The clinical consultation lifecycle (`SCHEDULED` &rarr; `IN_PROGRESS` &rarr; `COMPLETED`) with field-level encrypted clinical records.
* Immutable, versioned clinical prescriptions with prescriber authorization checks and AES-256-GCM encryption of sensitive diagnoses and medication schedules.
* Financial lifecycle tracking with idempotent payment intent creation and HMAC-SHA256 verified webhook processing.
* Real-time operational analytics and compliance audit trails.

---

## 2. High-Level Architecture & Data Flow

The platform is designed as a **Modular Monolith**. This eliminates distributed transaction hazards (e.g. 2PC overhead, dual-write split-brain, and network partitions) while preserving strict modular boundaries:

```mermaid
graph TD
    Client[Web & Mobile Clients] -->|HTTPS / TLS 1.3| Ingress[API Gateway / Reverse Proxy]
    
    subgraph Modular Monolith Node.js App
        Ingress -->|Request ID / Helmet / CORS| Middleware[Security & Auth Middleware]
        Middleware -->|Rate Limiting| RateLimiter[Token Bucket Limiter]
        RateLimiter -->|Idempotency-Key Header| IdempManager[Idempotency Engine]
        
        IdempManager --> AuthMod[Auth & Identity Module]
        IdempManager --> BookingMod[Appointments & Booking Engine]
        IdempManager --> ConsultMod[Consultation & Clinical Notes]
        IdempManager --> RxMod[Prescriptions Module]
        IdempManager --> PayMod[Payment & Webhook Engine]
        
        BookingMod -.->|Transactional Event Insert| Outbox[Transactional Outbox Table]
        ConsultMod -.->|Transactional Event Insert| Outbox
        PayMod -.->|Transactional Event Insert| Outbox
        
        OutboxWorker[Background Outbox Dispatcher] -->|Poll & Retry| Outbox
    end
    
    subgraph Data Tier
        AuthMod --> PG[(PostgreSQL Source of Truth)]
        BookingMod -->|Row Locks / Atomic Tx| PG
        ConsultMod -->|AES-256-GCM Encrypted Notes| PG
        RxMod -->|Immutable Encrypted Rows| PG
        PayMod --> PG
        IdempManager -->|Unique Fingerprint Keys| PG
        RateLimiter -.-> RedisCache[(Redis Cache & Ephemeral Sessions)]
    end
    
    subgraph Observability
        Middleware -.-> PromMetrics[Prometheus Exporter /metrics]
        Middleware -.-> JSONLogs[Structured JSON Logger]
    end
```

---

## 3. Booking Flow Sequence Diagram (Atomic Concurrency Control)

The booking engine constitutes the critical correctness boundary of the telemedicine platform. The sequence below illustrates how race conditions, simultaneous double bookings, and duplicate submissions are prevented:

```mermaid
sequenceDiagram
    autonumber
    actor Patient as Patient Client
    participant API as Express API Router
    participant Auth as Auth & RBAC Middleware
    participant Idemp as Idempotency Engine
    participant AppSvc as Appointments Service
    participant DB as PostgreSQL Transaction Boundary
    participant Outbox as Transactional Outbox Worker

    Patient->>API: POST /api/v1/appointments<br/>Headers: Authorization, Idempotency-Key
    API->>Auth: Validate JWT & Active Account Status
    Auth-->>API: Principal Identity Verified (role: PATIENT)
    
    API->>Idemp: Check Or Lock(Key, RequestFingerprint)
    alt Idempotency Key is Cached & RESOLVED
        Idemp-->>Patient: Return Stored Response (HTTP 201, X-Idempotent-Replay: true)
    else Idempotency Key in PENDING Status
        Idemp-->>Patient: HTTP 409 Conflict (Concurrent Request In Progress)
    else Idempotency Key Reused with Different Payload
        Idemp-->>Patient: HTTP 422 Unprocessable Entity (Payload Mismatch)
    else Fresh Key
        Idemp->>DB: INSERT INTO idempotency_keys (key, status='PENDING')
        API->>AppSvc: bookAppointment(patientId, doctorId, slotId)
        
        AppSvc->>DB: BEGIN TRANSACTION (Serializable / Row-Lock)
        AppSvc->>DB: SELECT * FROM availability_slots WHERE id = slotId FOR UPDATE
        
        alt Slot status != 'AVAILABLE' OR Slot belongs to another doctor
            DB-->>AppSvc: Slot Conflict
            AppSvc->>DB: ROLLBACK
            AppSvc->>Idemp: Mark Key 'FAILED'
            AppSvc-->>Patient: HTTP 409 Conflict ("Slot is no longer available")
        else Slot is AVAILABLE
            AppSvc->>DB: UPDATE availability_slots SET status = 'BOOKED' WHERE id = slotId
            AppSvc->>DB: INSERT INTO appointments (patient_id, doctor_id, slot_id, status='CONFIRMED')
            AppSvc->>DB: INSERT INTO consultations (appointment_id, status='SCHEDULED')
            AppSvc->>DB: INSERT INTO payments (appointment_id, status='PENDING')
            AppSvc->>DB: INSERT INTO outbox_events (type='APPOINTMENT_BOOKED', payload)
            AppSvc->>DB: INSERT INTO audit_logs (action='APPOINTMENT_BOOKED')
            AppSvc->>DB: COMMIT TRANSACTION
            
            AppSvc->>Idemp: Update Key (status='RESOLVED', response_body, code=201)
            AppSvc-->>Patient: HTTP 201 Created (Appointment, Consultation, Slot Details)
            
            par Asynchronous Notification Dispatch
                Outbox->>DB: Poll PENDING outbox_events
                Outbox->>Outbox: Dispatch SMS / Email to Patient & Doctor
                Outbox->>DB: UPDATE outbox_events SET status = 'PROCESSED'
            end
        end
    end
```

---

## 4. Entity-Relationship (ER) Diagram

The database architecture is fully normalized (3NF) and enforces referential integrity through foreign keys, check constraints, and unique indexes:

```mermaid
erDiagram
    users ||--o| profiles : "has demographic profile"
    users ||--o| doctors : "has doctor credential profile"
    users ||--o{ refresh_tokens : "owns active sessions"
    users ||--o{ appointments : "books as patient"
    users ||--o{ audit_logs : "triggers audit events"

    doctors ||--o{ availability_slots : "publishes schedule slots"
    doctors ||--o{ appointments : "conducts as doctor"
    doctors ||--o{ prescriptions : "prescribes clinical prescriptions"

    availability_slots ||--o| appointments : "exclusive booking reference"
    
    appointments ||--|| consultations : "spawns clinical encounter"
    appointments ||--|| payments : "settles financial charge"
    
    consultations ||--o{ prescriptions : "yields clinical prescriptions"

    users {
        uuid id PK
        varchar email UK
        varchar password_hash
        varchar role "PATIENT | DOCTOR | ADMIN"
        boolean is_active
        boolean mfa_enabled
        varchar mfa_secret "Encrypted"
        timestamp created_at
    }

    profiles {
        uuid id PK
        uuid user_id FK, UK
        varchar first_name
        varchar last_name
        varchar phone
        text medical_history_encrypted "AES-256-GCM"
    }

    doctors {
        uuid id PK
        uuid user_id FK, UK
        varchar specialization
        varchar license_number UK
        integer years_of_experience
        numeric consultation_fee
        boolean is_verified
    }

    availability_slots {
        uuid id PK
        uuid doctor_id FK
        timestamp start_time
        timestamp end_time
        varchar status "AVAILABLE | BOOKED | BLOCKED | CANCELLED"
    }

    appointments {
        uuid id PK
        uuid patient_id FK
        uuid doctor_id FK
        uuid slot_id FK, UK
        varchar status "BOOKED | CONFIRMED | IN_PROGRESS | COMPLETED | CANCELLED"
        numeric amount
    }

    consultations {
        uuid id PK
        uuid appointment_id FK, UK
        uuid patient_id FK
        uuid doctor_id FK
        varchar status "SCHEDULED | IN_PROGRESS | COMPLETED | CANCELLED"
        text clinical_notes_encrypted "AES-256-GCM"
    }

    prescriptions {
        uuid id PK
        uuid consultation_id FK
        uuid patient_id FK
        uuid doctor_id FK
        integer version "Incrementing version"
        text diagnosis_encrypted "AES-256-GCM"
        text medications_encrypted "AES-256-GCM JSON"
        boolean is_immutable
    }

    payments {
        uuid id PK
        uuid appointment_id FK, UK
        uuid patient_id FK
        numeric amount
        varchar status "PENDING | PROCESSING | SUCCEEDED | FAILED"
        varchar provider_transaction_id UK
    }

    idempotency_keys {
        varchar key PK
        uuid user_id
        varchar request_fingerprint
        varchar status "PENDING | RESOLVED | FAILED"
        integer response_code
        text response_body
        timestamp expires_at
    }

    outbox_events {
        uuid id PK
        varchar event_type
        text payload_json
        varchar status "PENDING | PROCESSED | FAILED"
        integer retry_count
    }
```

---

## 5. Capacity Sizing & Performance Model (100,000 Consultations / Day)

### 5.1 Throughput & Traffic Burst Model
* **Daily Consultation Target:** 100,000 consultations per day.
* **Peak Traffic Ratio:** Healthcare consultations peak during morning hours (08:00–12:00) and evening hours (17:00–20:00). We model an 8-hour active peak window (28,800 seconds).
* **Average Consultations per Second (Peak):** $100,000 / 28,800 \approx 3.47$ completed consultations / sec.
* **Booking Request Multiplier:** Each completed booking involves ~10 read requests (search doctors, fetch availability slots, view profiles) and ~3 write requests (booking intent, payment webhook, consultation lifecycle updates).
  * **Peak Read RPS:** $3.5 \times 10 \approx 35 - 50\text{ RPS}$ (Read p95 target: $< 200\text{ ms}$).
  * **Peak Write RPS:** $3.5 \times 3 \approx 10 - 20\text{ RPS}$ (Write p95 target: $< 500\text{ ms}$).
* **Connection Pooling:**
  * Node.js connection pool sized between 5 and 20 connections per instance.
  * 3 horizontally scaled container instances handle up to 60 concurrent database connections, well below PostgreSQL default limits of 100–200 connections.

---

## 6. Concurrency Control & Double-Booking Invariants

1. **Database-Level Exclusivity:**
   * Unique constraint `uq_doctor_slot_start` on `availability_slots(doctor_id, start_time)` prevents overlapping duplicate slots.
   * Unique constraint on `appointments(slot_id)` guarantees at the relational engine level that no slot can ever have more than one active appointment.
2. **Transaction Isolation & Row Locking:**
   * Booking logic runs inside an atomic `db.transaction()` block.
   * `SELECT FOR UPDATE` locks the slot row, ensuring that serial transactions cannot observe an intermediate `AVAILABLE` state while another transaction is committing.
3. **Double-Booking Verification:**
   * Automated concurrency suite (`tests/concurrency/double_booking.test.ts`) executes concurrent asynchronous `Promise.all` requests against the same slot, proving that exactly one request succeeds (HTTP 201) while all racing duplicates are rejected with HTTP 409 Conflict.

---

## 7. Idempotency Architecture

Every mutating endpoint (`/api/v1/appointments`, `/api/v1/payments`, `/api/v1/prescriptions`) accepts an optional or required `Idempotency-Key` HTTP header:
1. **Canonical Fingerprinting:** The request method, path, and sorted JSON body are digested with SHA-256 (`generateRequestFingerprint`).
2. **State Locking:** The key is inserted into `idempotency_keys` with `status = 'PENDING'`.
3. **Collision Detection:**
   * If a second request arrives with the same key while `PENDING`, it is rejected with **HTTP 409 Conflict** to prevent concurrent race conditions.
   * If a request arrives with an existing key but a modified payload, it is rejected with **HTTP 422 Unprocessable Entity**.
   * If the key is already `RESOLVED`, the stored response payload and HTTP status code are served directly with the header `X-Idempotent-Replay: true`.

---

## 8. Sensitive Health Information Protection & Encryption

* **Data at Rest:** Critical Protected Health Information (PHI) fields are encrypted using authenticated **AES-256-GCM** with unique 96-bit IVs and 128-bit authentication tags:
  * `profiles.medical_history_encrypted`
  * `consultations.clinical_notes_encrypted`
  * `prescriptions.diagnosis_encrypted`
  * `prescriptions.medications_encrypted`
* **Data in Transit:** TLS 1.3 encryption across all public ingress boundaries.
* **Redaction in Observability:** Passwords, JWT secrets, authentication tags, credit cards, and MFA secrets are redacted at the root logger level (`src/common/observability/logger.ts`).

---

## 9. Transactional Outbox Pattern & Asynchronous Operations

To prevent dual-write inconsistencies between database commits and message publication (e.g., appointment saved in DB, but email notification fails), the **Transactional Outbox Pattern** is utilized:
* Events (`APPOINTMENT_BOOKED`, `CONSULTATION_COMPLETED`, `PRESCRIPTION_ISSUED`, `PAYMENT_SUCCEEDED`) are inserted into `outbox_events` within the exact same database transaction as the business entity.
* A background loop (`src/server.ts` / `OutboxService`) continuously reads `PENDING` outbox records, dispatches notifications, and updates the status to `PROCESSED` with exponential backoff on retries.

---

## 10. Operational Readiness, Backups & Disaster Recovery

* **RPO (Recovery Point Objective):** $\le 5$ minutes via continuous PostgreSQL Write-Ahead Log (WAL) archiving.
* **RTO (Recovery Time Objective):** $\le 30$ minutes via containerized infrastructure and automated restore scripts.
* **Health Checks:** Separate `/health/live` (process health) and `/health/ready` (database connectivity probe).
* **Metrics:** Prometheus scrape target exposed at `/metrics` reporting low-cardinality HTTP latency histograms, error rates, and booking outcomes.
