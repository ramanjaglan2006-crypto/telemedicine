import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { db } from '../../src/infrastructure/database/db.js';

const app = createApp();

describe('Security: Tenancy, Anti-IDOR, and Cross-Role Access Control', () => {
  let patientAToken: string;
  let patientBToken: string;
  let doctorAToken: string;
  let doctorBToken: string;
  let patientAAppointmentId: string;
  let patientAConsultationId: string;

  beforeAll(async () => {
    db.clear();

    // 1. Doctor A
    const docARes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'docA@amrutam.com',
        password: 'Password123!',
        role: 'DOCTOR',
        firstName: 'Doctor',
        lastName: 'A',
        doctorProfile: {
          specialization: 'Ayurveda',
          licenseNumber: 'LIC-A-101',
          yearsOfExperience: 5,
          consultationFee: 500,
        },
      });
    doctorAToken = docARes.body.data.tokens.accessToken;
    const docAId = docARes.body.data.user.doctorId;

    // 2. Doctor B
    const docBRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'docB@amrutam.com',
        password: 'Password123!',
        role: 'DOCTOR',
        firstName: 'Doctor',
        lastName: 'B',
        doctorProfile: {
          specialization: 'Panchakarma',
          licenseNumber: 'LIC-B-102',
          yearsOfExperience: 7,
          consultationFee: 700,
        },
      });
    doctorBToken = docBRes.body.data.tokens.accessToken;

    // 3. Patient A
    const patARes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'patientA@example.com',
        password: 'Password123!',
        role: 'PATIENT',
        firstName: 'Patient',
        lastName: 'A',
      });
    patientAToken = patARes.body.data.tokens.accessToken;

    // 4. Patient B
    const patBRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'patientB@example.com',
        password: 'Password123!',
        role: 'PATIENT',
        firstName: 'Patient',
        lastName: 'B',
      });
    patientBToken = patBRes.body.data.tokens.accessToken;

    // 5. Slot for Doctor A
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const slotRes = await request(app)
      .post('/api/v1/availability/me')
      .set('Authorization', `Bearer ${doctorAToken}`)
      .send({
        slots: [
          {
            startTime: futureDate.toISOString(),
            endTime: new Date(futureDate.getTime() + 30 * 60 * 1000).toISOString(),
          },
        ],
      });
    const slotAId = slotRes.body.data[0].id;

    // 6. Patient A books Doctor A's slot
    const bookRes = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${patientAToken}`)
      .send({
        doctorId: docAId,
        slotId: slotAId,
      });

    patientAAppointmentId = bookRes.body.data.appointment.id;
    patientAConsultationId = bookRes.body.data.consultation.id;
  });

  it('Anti-IDOR: Patient B cannot view Patient A appointment (403 Forbidden)', async () => {
    const res = await request(app)
      .get(`/api/v1/appointments/${patientAAppointmentId}`)
      .set('Authorization', `Bearer ${patientBToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('Anti-IDOR: Patient B cannot view Patient A consultation (403 Forbidden)', async () => {
    const res = await request(app)
      .get(`/api/v1/consultations/${patientAConsultationId}`)
      .set('Authorization', `Bearer ${patientBToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('Cross-Doctor Isolation: Doctor B cannot start or complete Doctor A consultation', async () => {
    const res = await request(app)
      .post(`/api/v1/consultations/${patientAConsultationId}/start`)
      .set('Authorization', `Bearer ${doctorBToken}`);

    expect([403, 404]).toContain(res.status);
    expect(res.body.success).toBe(false);
  });

  it('Privilege Escalation Prevention: Non-admin patient cannot access admin analytics (403 Forbidden)', async () => {
    const res = await request(app)
      .get('/api/v1/admin/analytics/overview')
      .set('Authorization', `Bearer ${patientAToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('Authentication Guard: Protected endpoints reject requests with missing token (401 Unauthorized)', async () => {
    const res = await request(app).get('/api/v1/users/me');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});
