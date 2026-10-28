import { db } from '../../infrastructure/database/db.js';

export interface DoctorSearchFilter {
  specialization?: string;
  minExperience?: number;
  maxFee?: number;
  availableDate?: string; // YYYY-MM-DD
  page?: number;
  limit?: number;
}

export class SearchService {
  async searchDoctors(filters: DoctorSearchFilter) {
    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(50, Math.max(1, filters.limit || 10));

    const allDoctors = db.find('doctors', (d) => {
      if (d.is_verified === false) return false;

      if (filters.specialization) {
        const spec = (d.specialization as string).toLowerCase();
        if (!spec.includes(filters.specialization.toLowerCase())) return false;
      }

      if (filters.minExperience && (d.years_of_experience as number) < filters.minExperience) {
        return false;
      }

      if (filters.maxFee && Number(d.consultation_fee) > filters.maxFee) {
        return false;
      }

      if (filters.availableDate) {
        const dateStr = filters.availableDate;
        const hasSlot = db.findOne('availability_slots', (s) => {
          if (s.doctor_id !== d.id || s.status !== 'AVAILABLE') return false;
          const sDate = new Date(s.start_time as string).toISOString().split('T')[0];
          return sDate === dateStr;
        });
        if (!hasSlot) return false;
      }

      return true;
    });

    const total = allDoctors.length;
    const startIndex = (page - 1) * limit;
    const paginated = allDoctors.slice(startIndex, startIndex + limit);

    const items = paginated.map((doc) => {
      const profile = db.findOne('profiles', (p) => p.user_id === doc.user_id);
      return {
        id: doc.id,
        specialization: doc.specialization,
        licenseNumber: doc.license_number,
        yearsOfExperience: doc.years_of_experience,
        bio: doc.bio,
        consultationFee: doc.consultation_fee,
        name: profile ? `Dr. ${profile.first_name} ${profile.last_name}` : 'Doctor',
      };
    });

    return {
      items,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}

export const searchService = new SearchService();
