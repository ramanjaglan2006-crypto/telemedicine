import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import { createApp } from '../../src/app.js';
import { db } from '../../src/infrastructure/database/db.js';
import { env } from '../../src/config/env.js';

const app = createApp();

describe('Integration: Core Healthcare Workflows API', () => {
  let patientToken: string;
  let patientId: string;
  let doctorToken: string;
  let doctorId: string;
  let adminToken: string;
  let slotId: string;
  let appointmentId: string;
  let consultationId: string;

  beforeAll(() => {
    db.clear();
  });

  it('1. Should register an administrator', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'admin@amrutam.com',
        password: 'AdminPassword123!',
        role: 'ADMIN',
        firstName: 'System',
        lastName: 'Admin',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.role).toBe('ADMIN');
    adminToken = res.body.data.tokens.accessToken;
  });

  it('2. Should register a verified Doctor with professional profile', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'dr.sharma@amrutam.com',
        password: 'DoctorPassword123!',
        role: 'DOCTOR',
        firstName: 'Rajesh',
        lastName: 'Sharma',
        doctorProfile: {
          specialization: 'Ayurveda General Medicine',
          licenseNumber: 'AYUR-DEL-2015-8941',
          yearsOfExperience: 10,
          consultationFee: 600,
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe('DOCTOR');
    doctorToken = res.body.data.tokens.accessToken;
    doctorId = res.body.data.user.doctorId;
  });

  it('3. Should register a Patient', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'patient.arjun@example.com',
        password: 'PatientPassword123!',
        role: 'PATIENT',
        firstName: 'Arjun',
        lastName: 'Verma',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe('PATIENT');
    patientToken = res.body.data.tokens.accessToken;
    patientId = res.body.data.user.id;
  });

  it('4. Doctor creates availability slots in UTC', async () => {
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    futureDate.setHours(10, 0, 0, 0);
    const startIso = futureDate.toISOString();
    const endIso = new Date(futureDate.getTime() + 30 * 60 * 1000).toISOString();

    const res = await request(app)
      .post('/api/v1/availability/me')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        slots: [
          { startTime: startIso, endTime: endIso },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].status).toBe('AVAILABLE');
    slotId = res.body.data[0].id;
  });

  it('5. Doctor slot overlap is strictly rejected', async () => {
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    futureDate.setHours(10, 15, 0, 0); // Overlaps with 10:00 - 10:30
    const startIso = futureDate.toISOString();
    const endIso = new Date(futureDate.getTime() + 30 * 60 * 1000).toISOString();

    const res = await request(app)
      .post('/api/v1/availability/me')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        slots: [{ startTime: startIso, endTime: endIso }],
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('6. Patient books appointment atomically with Idempotency Key', async () => {
    const idempotencyKey = 'idemp_test_booking_001';

    const res = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${patientToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        doctorId,
        slotId,
        consultationType: 'VIDEO',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.appointment.status).toBe('CONFIRMED');
    expect(res.body.data.slot.status).toBe('BOOKED');
    expect(res.body.data.consultation.status).toBe('SCHEDULED');

    appointmentId = res.body.data.appointment.id;
    consultationId = res.body.data.consultation.id;
  });

  it('7. Doctor starts consultation (SCHEDULED -> IN_PROGRESS)', async () => {
    const res = await request(app)
      .post(`/api/v1/consultations/${consultationId}/start`)
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('IN_PROGRESS');
  });

  it('8. Doctor issues prescription with AES-256-GCM encryption & versioning', async () => {
    const res = await request(app)
      .post(`/api/v1/prescriptions/consultations/${consultationId}/prescriptions`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        diagnosis: 'Acute Pitta-aggravated gastritis with hyperacidity',
        medications: [
          {
            name: 'Avipattikar Churna',
            dosage: '5g',
            frequency: 'Twice daily before meals',
            durationDays: 14,
          },
          {
            name: 'Kamadudha Ras',
            dosage: '250mg',
            frequency: 'Once daily after breakfast',
            durationDays: 14,
          },
        ],
        instructions: 'Avoid spicy, sour foods and late dinners.',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.version).toBe(1);
    expect(res.body.data.isImmutable).toBe(true);
    expect(res.body.data.diagnosis).toContain('gastritis');
  });

  it('9. Doctor completes consultation with clinical notes (IN_PROGRESS -> COMPLETED)', async () => {
    const res = await request(app)
      .post(`/api/v1/consultations/${consultationId}/complete`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        clinicalNotes: 'Patient responded well to dietary counseling. Follow up in 14 days.',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('COMPLETED');
    expect(res.body.data.clinicalNotes).toContain('dietary counseling');
  });

  it('10. Processes payment webhook with verified HMAC signature idempotently', async () => {
    const webhookEvent = {
      id: 'evt_stripe_test_001',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_test_stripe_123',
          amount: 60000,
          status: 'succeeded',
          metadata: { appointmentId },
        },
      },
    };

    const rawPayload = JSON.stringify(webhookEvent);
    const signature = crypto
      .createHmac('sha256', env.WEBHOOK_SECRET_STRIPE)
      .update(rawPayload)
      .digest('hex');

    const res = await request(app)
      .post('/api/v1/payments/webhooks/stripe')
      .set('Stripe-Signature', signature)
      .send(webhookEvent);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('processed_success');

    // Duplicate webhook replay should be handled safely without error
    const resDup = await request(app)
      .post('/api/v1/payments/webhooks/stripe')
      .set('Stripe-Signature', signature)
      .send(webhookEvent);

    expect(resDup.status).toBe(200);
    expect(resDup.body.message).toContain('Duplicate event ignored');
  });

  it('11. Admin retrieves overview analytics', async () => {
    const res = await request(app)
      .get('/api/v1/admin/analytics/overview')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.appointments.total).toBeGreaterThanOrEqual(1);
    expect(res.body.data.consultations.total).toBeGreaterThanOrEqual(1);
    expect(res.body.data.capacity.totalVerifiedDoctors).toBeGreaterThanOrEqual(1);
  });
});
