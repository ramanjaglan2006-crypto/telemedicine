import { db } from '../../infrastructure/database/db.js';
import {
  NotFoundError,
  BadRequestError,
  ForbiddenError,
} from '../../common/errors/AppError.js';
import { encryptField, decryptField } from '../../common/security/crypto.js';
import { OutboxService } from '../../infrastructure/outbox/outbox.service.js';

export interface IssuePrescriptionInput {
  consultationId: string;
  diagnosis: string;
  medications: Array<{
    name: string;
    dosage: string;
    frequency: string;
    durationDays: number;
    instructions?: string;
  }>;
  instructions?: string;
}

export class PrescriptionsService {
  async issuePrescription(actorId: string, input: IssuePrescriptionInput) {
    const doctor = db.findOne('doctors', (d) => d.user_id === actorId);
    if (!doctor) throw new ForbiddenError('Only licensed doctors can issue prescriptions');

    const consultation = db.findById('consultations', input.consultationId);
    if (!consultation || consultation.doctor_id !== doctor.id) {
      throw new NotFoundError('Consultation not found for this doctor');
    }

    if (consultation.status !== 'IN_PROGRESS' && consultation.status !== 'COMPLETED') {
      throw new BadRequestError('Prescriptions can only be issued during or after consultation completion');
    }

    // Determine prescription version
    const existingPrescriptions = db.find(
      'prescriptions',
      (p) => p.consultation_id === input.consultationId
    );
    const nextVersion = existingPrescriptions.length + 1;

    // Encrypt clinical information
    const encryptedDiagnosis = encryptField(input.diagnosis);
    const encryptedMedications = encryptField(JSON.stringify(input.medications));

    const prescription = db.insert('prescriptions', {
      consultation_id: input.consultationId,
      patient_id: consultation.patient_id,
      doctor_id: doctor.id,
      version: nextVersion,
      diagnosis_encrypted: encryptedDiagnosis,
      medications_encrypted: encryptedMedications,
      instructions: input.instructions || null,
      is_immutable: true,
    });

    OutboxService.recordEvent('PRESCRIPTION_ISSUED', {
      prescriptionId: prescription.id,
      consultationId: input.consultationId,
      patientId: consultation.patient_id,
      doctorId: doctor.id,
      version: nextVersion,
    });

    db.insert('audit_logs', {
      user_id: actorId,
      action: 'PRESCRIPTION_ISSUED',
      resource_type: 'PRESCRIPTION',
      resource_id: prescription.id as string,
      metadata_json: JSON.stringify({ version: nextVersion }),
    });

    return {
      id: prescription.id,
      consultationId: input.consultationId,
      patientId: consultation.patient_id,
      doctorId: doctor.id,
      version: nextVersion,
      diagnosis: input.diagnosis,
      medications: input.medications,
      instructions: input.instructions || null,
      isImmutable: true,
      createdAt: prescription.created_at,
    };
  }

  async getPrescriptionById(actorId: string, role: string, prescriptionId: string) {
    const p = db.findById('prescriptions', prescriptionId);
    if (!p) throw new NotFoundError('Prescription not found');

    // Access check
    if (role === 'PATIENT' && p.patient_id !== actorId) {
      throw new ForbiddenError('You are not authorized to access this prescription');
    }

    if (role === 'DOCTOR') {
      const doctor = db.findOne('doctors', (d) => d.user_id === actorId);
      if (!doctor || p.doctor_id !== doctor.id) {
        throw new ForbiddenError('You are not authorized to access this prescription');
      }
    }

    // Decrypt data for authorized viewer
    let diagnosis = '[Decryption failed]';
    let medications: unknown[] = [];
    try {
      diagnosis = decryptField(p.diagnosis_encrypted as string);
      medications = JSON.parse(decryptField(p.medications_encrypted as string));
    } catch {
      // Decryption fallback
    }

    return {
      id: p.id,
      consultationId: p.consultation_id,
      patientId: p.patient_id,
      doctorId: p.doctor_id,
      version: p.version,
      diagnosis,
      medications,
      instructions: p.instructions,
      isImmutable: p.is_immutable,
      createdAt: p.created_at,
    };
  }

  async listPrescriptionsForConsultation(actorId: string, role: string, consultationId: string) {
    const consultation = db.findById('consultations', consultationId);
    if (!consultation) throw new NotFoundError('Consultation not found');

    if (role === 'PATIENT' && consultation.patient_id !== actorId) {
      throw new ForbiddenError('You are not authorized to view prescriptions for this consultation');
    }

    if (role === 'DOCTOR') {
      const doctor = db.findOne('doctors', (d) => d.user_id === actorId);
      if (!doctor || consultation.doctor_id !== doctor.id) {
        throw new ForbiddenError('You are not authorized to view prescriptions for this consultation');
      }
    }

    const prescriptions = db.find('prescriptions', (p) => p.consultation_id === consultationId);

    return prescriptions.map((p) => {
      let diagnosis = '';
      let medications = [];
      try {
        diagnosis = decryptField(p.diagnosis_encrypted as string);
        medications = JSON.parse(decryptField(p.medications_encrypted as string));
      } catch {
        diagnosis = '[Decryption failed]';
      }

      return {
        id: p.id,
        consultationId: p.consultation_id,
        version: p.version,
        diagnosis,
        medications,
        instructions: p.instructions,
        createdAt: p.created_at,
      };
    });
  }
}

export const prescriptionsService = new PrescriptionsService();
