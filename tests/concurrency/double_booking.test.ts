import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { db } from '../../src/infrastructure/database/db.js';

const app = createApp();

describe('Concurrency & Double-Booking Protection Tests', () => {
  let doctorId: string;
  let slotId: string;
  let patient1Token: string;
  let patient2Token: string;

  beforeEach(async () => {
    db.clear();

    // 1. Create Doctor
    const docRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'dr.concurrency@amrutam.com',
        password: 'DoctorPassword123!',
        role: 'DOCTOR',
        firstName: 'Vikram',
        lastName: 'Aditya',
        doctorProfile: {
          specialization: 'Kayachikitsa',
          licenseNumber: 'DOC-CONCURRENCY-001',
          yearsOfExperience: 15,
          consultationFee: 800,
        },
      });

    doctorId = docRes.body.data.user.doctorId;
    const docToken = docRes.body.data.tokens.accessToken;

    // 2. Create Single Exclusive Availability Slot
    const futureDate = new Date(Date.now() + 48 * 60 * 60 * 1000);
    futureDate.setHours(14, 0, 0, 0);

    const slotRes = await request(app)
      .post('/api/v1/availability/me')
      .set('Authorization', `Bearer ${docToken}`)
      .send({
        slots: [
          {
            startTime: futureDate.toISOString(),
            endTime: new Date(futureDate.getTime() + 30 * 60 * 1000).toISOString(),
          },
        ],
      });

    slotId = slotRes.body.data[0].id;

    // 3. Register Patient 1
    const p1Res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'patient1.race@example.com',
        password: 'Password123!',
        role: 'PATIENT',
        firstName: 'Rohan',
        lastName: 'Das',
      });
    patient1Token = p1Res.body.data.tokens.accessToken;

    // 4. Register Patient 2
    const p2Res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'patient2.race@example.com',
        password: 'Password123!',
        role: 'PATIENT',
        firstName: 'Kavita',
        lastName: 'Iyer',
      });
    patient2Token = p2Res.body.data.tokens.accessToken;
  });

  it('CRITICAL: Two patients racing to book the same slot -> Exactly ONE succeeds, ONE receives 409 Conflict', async () => {
    // Fire both requests concurrently using Promise.all
    const [res1, res2] = await Promise.all([
      request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${patient1Token}`)
        .send({ doctorId, slotId, consultationType: 'VIDEO' }),
      request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${patient2Token}`)
        .send({ doctorId, slotId, consultationType: 'VIDEO' }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    
    // Exactly one must be 201 Created and exactly one must be 409 Conflict
    expect(statuses).toEqual([201, 409]);

    const conflictResponse = res1.status === 409 ? res1 : res2;
    expect(conflictResponse.body.error.code).toBe('CONFLICT');

    // Verify database state: Exactly one appointment exists for this slot
    const appointmentsInDb = db.find('appointments', (a) => a.slot_id === slotId);
    expect(appointmentsInDb).toHaveLength(1);

    // Verify slot status in database is BOOKED
    const slotInDb = db.findById('availability_slots', slotId);
    expect(slotInDb?.status).toBe('BOOKED');
  });

  it('CRITICAL: Idempotency Key safe replay returns identical outcome without duplicate record creation', async () => {
    const key = 'idem_key_race_test_999';

    // 1. Initial request
    const res1 = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${patient1Token}`)
      .set('Idempotency-Key', key)
      .send({ doctorId, slotId, consultationType: 'VIDEO' });

    expect(res1.status).toBe(201);
    const appointmentId = res1.body.data.appointment.id;

    // 2. Immediate duplicate replay with same Idempotency-Key and payload
    const res2 = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${patient1Token}`)
      .set('Idempotency-Key', key)
      .send({ doctorId, slotId, consultationType: 'VIDEO' });

    expect(res2.status).toBe(201);
    expect(res2.header['x-idempotent-replay']).toBe('true');
    expect(res2.body.data.appointment.id).toBe(appointmentId);

    // Verify DB still contains only ONE appointment
    const appointmentsInDb = db.find('appointments', (a) => a.slot_id === slotId);
    expect(appointmentsInDb).toHaveLength(1);
  });

  it('CRITICAL: Idempotency Key reused with different payload is rejected with 422 Unprocessable Entity', async () => {
    const key = 'idem_key_mismatch_test_123';

    // 1. Initial request
    const res1 = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${patient1Token}`)
      .set('Idempotency-Key', key)
      .send({ doctorId, slotId, consultationType: 'VIDEO' });

    expect(res1.status).toBe(201);

    // 2. Replay with different consultationType payload ('AUDIO' instead of 'VIDEO')
    const res2 = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${patient1Token}`)
      .set('Idempotency-Key', key)
      .send({ doctorId, slotId, consultationType: 'AUDIO' });

    expect(res2.status).toBe(422);
    expect(res2.body.error.code).toBe('UNPROCESSABLE_ENTITY');
    expect(res2.body.error.message).toContain('previously used with a different request payload');
  });
});
