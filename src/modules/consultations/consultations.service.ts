import { db } from '../../infrastructure/database/db.js';
import { NotFoundError, BadRequestError, ForbiddenError } from '../../common/errors/AppError.js';
import { encryptField, decryptField } from '../../common/security/crypto.js';
import { OutboxService } from '../../infrastructure/outbox/outbox.service.js';

export class ConsultationsService {
  async getConsultationById(actorId: string, role: string, consultationId: string) {
    const consultation = db.findById('consultations', consultationId);
    if (!consultation) throw new NotFoundError('Consultation not found');

    // Access check: only patient or doctor in this consultation, or admin
    if (role === 'PATIENT' && consultation.patient_id !== actorId) {
      throw new ForbiddenError('You are not authorized to access this consultation');
    }

    if (role === 'DOCTOR') {
      const doctor = db.findOne('doctors', (d) => d.user_id === actorId);
      if (!doctor || consultation.doctor_id !== doctor.id) {
        throw new ForbiddenError('You are not authorized to access this consultation');
      }
    }

    let clinicalNotes: string | null = null;
    if (consultation.clinical_notes_encrypted) {
      try {
        clinicalNotes = decryptField(consultation.clinical_notes_encrypted as string);
      } catch {
        clinicalNotes = '[Decryption error]';
      }
    }

    const prescriptions = db.find('prescriptions', (p) => p.consultation_id === consultationId);

    return {
      ...consultation,
      clinicalNotes,
      prescriptionsCount: prescriptions.length,
    };
  }

  async startConsultation(actorId: string, consultationId: string) {
    const doctor = db.findOne('doctors', (d) => d.user_id === actorId);
    if (!doctor) throw new ForbiddenError('Only the assigned doctor can start this consultation');

    const consultation = db.findById('consultations', consultationId);
    if (!consultation || consultation.doctor_id !== doctor.id) {
      throw new NotFoundError('Consultation not found for this doctor');
    }

    if (consultation.status !== 'SCHEDULED') {
      throw new BadRequestError(`Cannot start consultation with status '${consultation.status}'`);
    }

    const now = new Date();
    const updated = db.update('consultations', consultationId, {
      status: 'IN_PROGRESS',
      started_at: now.toISOString(),
    });

    // Update appointment status to IN_PROGRESS
    db.update('appointments', consultation.appointment_id as string, {
      status: 'IN_PROGRESS',
    });

    db.insert('audit_logs', {
      user_id: actorId,
      action: 'CONSULTATION_STARTED',
      resource_type: 'CONSULTATION',
      resource_id: consultationId,
    });

    return updated;
  }

  async completeConsultation(actorId: string, consultationId: string, clinicalNotes?: string) {
    const doctor = db.findOne('doctors', (d) => d.user_id === actorId);
    if (!doctor) throw new ForbiddenError('Only the assigned doctor can complete this consultation');

    const consultation = db.findById('consultations', consultationId);
    if (!consultation || consultation.doctor_id !== doctor.id) {
      throw new NotFoundError('Consultation not found for this doctor');
    }

    if (consultation.status !== 'IN_PROGRESS') {
      throw new BadRequestError(`Cannot complete consultation with status '${consultation.status}'. Must be IN_PROGRESS.`);
    }

    const encryptedNotes = clinicalNotes ? encryptField(clinicalNotes) : null;
    const now = new Date();

    const updated = db.update('consultations', consultationId, {
      status: 'COMPLETED',
      clinical_notes_encrypted: encryptedNotes,
      completed_at: now.toISOString(),
    });

    // Update appointment status to COMPLETED
    db.update('appointments', consultation.appointment_id as string, {
      status: 'COMPLETED',
    });

    OutboxService.recordEvent('CONSULTATION_COMPLETED', {
      consultationId,
      appointmentId: consultation.appointment_id,
      patientId: consultation.patient_id,
      doctorId: consultation.doctor_id,
    });

    db.insert('audit_logs', {
      user_id: actorId,
      action: 'CONSULTATION_COMPLETED',
      resource_type: 'CONSULTATION',
      resource_id: consultationId,
    });

    return {
      ...updated,
      clinicalNotes: clinicalNotes || null,
    };
  }
}

export const consultationsService = new ConsultationsService();
