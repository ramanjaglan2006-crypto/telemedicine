import { db } from '../../infrastructure/database/db.js';
import { NotFoundError, BadRequestError, ForbiddenError, ConflictError } from '../../common/errors/AppError.js';

export interface CreateSlotInput {
  startTime: string; // ISO-8601 UTC string
  endTime: string;   // ISO-8601 UTC string
}

export class AvailabilityService {
  async getDoctorAvailability(doctorId: string, fromDate?: string, toDate?: string) {
    const doctor = db.findById('doctors', doctorId);
    if (!doctor) throw new NotFoundError('Doctor not found');

    const now = new Date();
    const fromTime = fromDate ? new Date(fromDate).getTime() : now.getTime();
    const toTime = toDate ? new Date(toDate).getTime() : fromTime + 30 * 24 * 60 * 60 * 1000;

    const slots = db.find('availability_slots', (s) => {
      if (s.doctor_id !== doctorId) return false;
      const slotTime = new Date(s.start_time as string).getTime();
      return slotTime >= fromTime && slotTime <= toTime;
    });

    // Sort chronologically
    return slots.sort((a, b) => new Date(a.start_time as string).getTime() - new Date(b.start_time as string).getTime());
  }

  async createSlots(userId: string, slotsInput: CreateSlotInput[]) {
    const doctor = db.findOne('doctors', (d) => d.user_id === userId);
    if (!doctor) {
      throw new ForbiddenError('Only registered doctors can create availability slots');
    }

    const doctorId = doctor.id as string;
    const createdSlots = [];

    for (const input of slotsInput) {
      const start = new Date(input.startTime);
      const end = new Date(input.endTime);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        throw new BadRequestError('Invalid date format for slot. Must be ISO-8601');
      }

      if (start >= end) {
        throw new BadRequestError('Slot startTime must be strictly before endTime');
      }

      if (start.getTime() < Date.now()) {
        throw new BadRequestError('Cannot create availability slots in the past');
      }

      // Check slot duration between 15 minutes and 120 minutes
      const durationMinutes = (end.getTime() - start.getTime()) / (60 * 1000);
      if (durationMinutes < 15 || durationMinutes > 120) {
        throw new BadRequestError('Slot duration must be between 15 and 120 minutes');
      }

      // Check overlapping slots for this doctor
      const existingOverlap = db.findOne('availability_slots', (s) => {
        if (s.doctor_id !== doctorId || s.status === 'CANCELLED') return false;
        const eStart = new Date(s.start_time as string).getTime();
        const eEnd = new Date(s.end_time as string).getTime();
        // Overlap condition: start < eEnd and end > eStart
        return start.getTime() < eEnd && end.getTime() > eStart;
      });

      if (existingOverlap) {
        throw new ConflictError(
          `Slot overlapping with an existing slot from ${existingOverlap.start_time} to ${existingOverlap.end_time}`
        );
      }

      const slot = db.insert('availability_slots', {
        doctor_id: doctorId,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        status: 'AVAILABLE',
      });

      createdSlots.push(slot);
    }

    return createdSlots;
  }

  async updateSlotStatus(userId: string, slotId: string, status: 'AVAILABLE' | 'BLOCKED' | 'CANCELLED') {
    const doctor = db.findOne('doctors', (d) => d.user_id === userId);
    if (!doctor) throw new ForbiddenError('Only registered doctors can manage slots');

    const slot = db.findById('availability_slots', slotId);
    if (!slot || slot.doctor_id !== doctor.id) {
      throw new NotFoundError('Availability slot not found');
    }

    if (slot.status === 'BOOKED') {
      throw new BadRequestError('Cannot modify or block a slot that has already been booked');
    }

    const updated = db.update('availability_slots', slotId, { status });
    return updated;
  }
}

export const availabilityService = new AvailabilityService();
