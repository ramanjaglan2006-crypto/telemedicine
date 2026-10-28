import { db } from '../../infrastructure/database/db.js';
import {
  NotFoundError,
  BadRequestError,
  ForbiddenError,
  ConflictError,
} from '../../common/errors/AppError.js';
import { bookingOperationsCounter } from '../../common/observability/metrics.js';
import { OutboxService } from '../../infrastructure/outbox/outbox.service.js';

export interface BookAppointmentInput {
  patientId: string;
  doctorId: string;
  slotId: string;
  consultationType?: 'VIDEO' | 'AUDIO' | 'CHAT';
}

export class AppointmentsService {
  /**
   * Atomic Double-Booking Protected Appointment Creation
   */
  async bookAppointment(input: BookAppointmentInput) {
    const { patientId, doctorId, slotId, consultationType = 'VIDEO' } = input;

    // Execute inside atomic unit of work with rollback guarantees
    return db.transaction(async () => {
      // 1. Validate Doctor
      const doctor = db.findById('doctors', doctorId);
      if (!doctor || doctor.is_verified === false) {
        bookingOperationsCounter.inc({ outcome: 'error' });
        throw new NotFoundError('Doctor not found or not verified for bookings');
      }

      // 2. Lock & Validate Slot
      const slot = db.findById('availability_slots', slotId);
      if (!slot || slot.doctor_id !== doctorId) {
        bookingOperationsCounter.inc({ outcome: 'error' });
        throw new NotFoundError('Availability slot not found for this doctor');
      }

      if (slot.status !== 'AVAILABLE') {
        bookingOperationsCounter.inc({ outcome: 'conflict_double_booking' });
        throw new ConflictError(
          `Slot is no longer available for booking (current status: ${slot.status})`
        );
      }

      if (new Date(slot.start_time as string).getTime() < Date.now()) {
        bookingOperationsCounter.inc({ outcome: 'slot_unavailable' });
        throw new BadRequestError('Cannot book an availability slot in the past');
      }

      // 3. Prevent patient double-booking in overlapping time
      const patientExisting = db.findOne('appointments', (a) => {
        if (a.patient_id !== patientId || a.status === 'CANCELLED') return false;
        const appSlot = db.findById('availability_slots', a.slot_id as string);
        if (!appSlot) return false;
        return appSlot.start_time === slot.start_time;
      });

      if (patientExisting) {
        bookingOperationsCounter.inc({ outcome: 'conflict_double_booking' });
        throw new ConflictError('You already have another active appointment at this time');
      }

      // 4. Atomically flip slot status to BOOKED
      const updatedSlot = db.update('availability_slots', slotId, { status: 'BOOKED' })!;

      // 5. Create Appointment Record
      const fee = Number(doctor.consultation_fee) || 0;
      const appointment = db.insert('appointments', {
        patient_id: patientId,
        doctor_id: doctorId,
        slot_id: slotId,
        status: 'CONFIRMED',
        consultation_type: consultationType,
        amount: fee,
      });

      const appointmentId = appointment.id as string;

      // 6. Create Clinical Consultation Record
      const consultation = db.insert('consultations', {
        appointment_id: appointmentId,
        patient_id: patientId,
        doctor_id: doctorId,
        status: 'SCHEDULED',
        clinical_notes_encrypted: null,
      });

      // 7. Create Payment Record (PENDING)
      const payment = db.insert('payments', {
        appointment_id: appointmentId,
        patient_id: patientId,
        amount: fee,
        currency: 'INR',
        status: 'PENDING',
        provider: 'STRIPE',
        provider_transaction_id: null,
      });

      // 8. Record Outbox Event for async notification
      OutboxService.recordEvent('APPOINTMENT_BOOKED', {
        appointmentId,
        patientId,
        doctorId,
        slotStartTime: slot.start_time,
        fee,
      });

      // 9. Audit Log
      db.insert('audit_logs', {
        user_id: patientId,
        action: 'APPOINTMENT_BOOKED',
        resource_type: 'APPOINTMENT',
        resource_id: appointmentId,
        metadata_json: JSON.stringify({ doctorId, slotId, fee }),
      });

      bookingOperationsCounter.inc({ outcome: 'success' });

      return {
        appointment,
        consultation,
        payment,
        slot: updatedSlot,
      };
    });
  }

  async getAppointmentById(actorId: string, role: string, appointmentId: string) {
    const appointment = db.findById('appointments', appointmentId);
    if (!appointment) throw new NotFoundError('Appointment not found');

    // Tenancy / Object-Level Authorization Check
    if (role === 'PATIENT' && appointment.patient_id !== actorId) {
      throw new ForbiddenError('You are not authorized to view this appointment');
    }

    if (role === 'DOCTOR') {
      const doctor = db.findOne('doctors', (d) => d.user_id === actorId);
      if (!doctor || appointment.doctor_id !== doctor.id) {
        throw new ForbiddenError('You are not authorized to view this appointment');
      }
    }

    const slot = db.findById('availability_slots', appointment.slot_id as string);
    const doctor = db.findById('doctors', appointment.doctor_id as string);
    const patientProfile = db.findOne('profiles', (p) => p.user_id === appointment.patient_id);
    const doctorProfile = doctor ? db.findOne('profiles', (p) => p.user_id === doctor.user_id) : null;
    const consultation = db.findOne('consultations', (c) => c.appointment_id === appointment.id);

    return {
      ...appointment,
      slot,
      doctor: doctor ? {
        id: doctor.id,
        specialization: doctor.specialization,
        name: doctorProfile ? `Dr. ${doctorProfile.first_name} ${doctorProfile.last_name}` : 'Doctor',
      } : null,
      patient: patientProfile ? {
        id: appointment.patient_id,
        name: `${patientProfile.first_name} ${patientProfile.last_name}`,
      } : null,
      consultationId: consultation?.id || null,
    };
  }

  async listAppointments(actorId: string, role: string) {
    if (role === 'PATIENT') {
      return db.find('appointments', (a) => a.patient_id === actorId);
    }

    if (role === 'DOCTOR') {
      const doctor = db.findOne('doctors', (d) => d.user_id === actorId);
      if (!doctor) return [];
      return db.find('appointments', (a) => a.doctor_id === doctor.id);
    }

    // ADMIN can view all
    return db.find('appointments');
  }

  async cancelAppointment(actorId: string, role: string, appointmentId: string, reason?: string) {
    return db.transaction(async () => {
      const appointment = db.findById('appointments', appointmentId);
      if (!appointment) throw new NotFoundError('Appointment not found');

      // Authorization check
      if (role === 'PATIENT' && appointment.patient_id !== actorId) {
        throw new ForbiddenError('You can only cancel your own appointments');
      }

      if (role === 'DOCTOR') {
        const doctor = db.findOne('doctors', (d) => d.user_id === actorId);
        if (!doctor || appointment.doctor_id !== doctor.id) {
          throw new ForbiddenError('You can only cancel appointments scheduled with you');
        }
      }

      if (['COMPLETED', 'CANCELLED'].includes(appointment.status as string)) {
        throw new BadRequestError(`Cannot cancel appointment with status '${appointment.status}'`);
      }

      // Mark appointment as CANCELLED
      db.update('appointments', appointmentId, {
        status: 'CANCELLED',
      });

      // Release availability slot if slot is still in the future
      const slot = db.findById('availability_slots', appointment.slot_id as string);
      if (slot && new Date(slot.start_time as string).getTime() > Date.now()) {
        db.update('availability_slots', slot.id as string, {
          status: 'AVAILABLE',
        });
      }

      // Cancel associated consultation
      const consultation = db.findOne('consultations', (c) => c.appointment_id === appointmentId);
      if (consultation) {
        db.update('consultations', consultation.id as string, {
          status: 'CANCELLED',
        });
      }

      // Outbox and Audit
      OutboxService.recordEvent('APPOINTMENT_CANCELLED', {
        appointmentId,
        cancelledBy: actorId,
        reason: reason || 'Patient / Doctor cancellation',
      });

      db.insert('audit_logs', {
        user_id: actorId,
        action: 'APPOINTMENT_CANCELLED',
        resource_type: 'APPOINTMENT',
        resource_id: appointmentId,
        metadata_json: JSON.stringify({ reason }),
      });

      return { success: true, appointmentId, status: 'CANCELLED' };
    });
  }

  async rescheduleAppointment(
    actorId: string,
    role: string,
    appointmentId: string,
    newSlotId: string
  ) {
    return db.transaction(async () => {
      const appointment = db.findById('appointments', appointmentId);
      if (!appointment) throw new NotFoundError('Appointment not found');

      if (role === 'PATIENT' && appointment.patient_id !== actorId) {
        throw new ForbiddenError('You can only reschedule your own appointments');
      }

      if (['COMPLETED', 'CANCELLED'].includes(appointment.status as string)) {
        throw new BadRequestError(`Cannot reschedule appointment with status '${appointment.status}'`);
      }

      // Validate new slot
      const newSlot = db.findById('availability_slots', newSlotId);
      if (!newSlot || newSlot.doctor_id !== appointment.doctor_id) {
        throw new NotFoundError('New slot not found or belongs to a different doctor');
      }

      if (newSlot.status !== 'AVAILABLE') {
        throw new ConflictError('The requested new slot is not available');
      }

      // Release old slot
      const oldSlotId = appointment.slot_id as string;
      db.update('availability_slots', oldSlotId, { status: 'AVAILABLE' });

      // Book new slot
      db.update('availability_slots', newSlotId, { status: 'BOOKED' });

      // Update appointment
      db.update('appointments', appointmentId, {
        slot_id: newSlotId,
        status: 'RESCHEDULED',
      });

      OutboxService.recordEvent('APPOINTMENT_RESCHEDULED', {
        appointmentId,
        oldSlotId,
        newSlotId,
      });

      return {
        success: true,
        appointmentId,
        oldSlotId,
        newSlotId,
        status: 'RESCHEDULED',
      };
    });
  }
}

export const appointmentsService = new AppointmentsService();
