import { db } from '../../infrastructure/database/db.js';
import { NotFoundError, ForbiddenError } from '../../common/errors/AppError.js';
import { cacheService } from '../../infrastructure/cache/cache.service.js';

export class DoctorsService {
  async listDoctors(filters: { specialization?: string; minExperience?: number }) {
    const cacheKey = `doctors:list:${filters.specialization || 'all'}:${filters.minExperience || 0}`;

    return cacheService.getOrSet(cacheKey, 60, async () => {
      const doctors = db.find('doctors', (d) => {
        if (d.is_verified === false) return false;
        if (filters.specialization && !((d.specialization as string).toLowerCase().includes(filters.specialization.toLowerCase()))) {
          return false;
        }
        if (filters.minExperience && (d.years_of_experience as number) < filters.minExperience) {
          return false;
        }
        return true;
      });

      return doctors.map((doc) => {
        const profile = db.findOne('profiles', (p) => p.user_id === doc.user_id);
        return {
          id: doc.id,
          userId: doc.user_id,
          specialization: doc.specialization,
          licenseNumber: doc.license_number,
          yearsOfExperience: doc.years_of_experience,
          bio: doc.bio,
          consultationFee: doc.consultation_fee,
          isVerified: doc.is_verified,
          name: profile ? `Dr. ${profile.first_name} ${profile.last_name}` : 'Doctor',
        };
      });
    });
  }

  async getDoctorById(id: string) {
    const cacheKey = `doctor:detail:${id}`;

    return cacheService.getOrSet(cacheKey, 120, async () => {
      const doc = db.findById('doctors', id);
      if (!doc) throw new NotFoundError('Doctor not found');

      const profile = db.findOne('profiles', (p) => p.user_id === doc.user_id);
      return {
        id: doc.id,
        userId: doc.user_id,
        specialization: doc.specialization,
        licenseNumber: doc.license_number,
        yearsOfExperience: doc.years_of_experience,
        bio: doc.bio,
        consultationFee: doc.consultation_fee,
        isVerified: doc.is_verified,
        name: profile ? `Dr. ${profile.first_name} ${profile.last_name}` : 'Doctor',
      };
    });
  }

  async updateDoctorProfile(userId: string, updates: {
    specialization?: string;
    yearsOfExperience?: number;
    bio?: string;
    consultationFee?: number;
  }) {
    const doc = db.findOne('doctors', (d) => d.user_id === userId);
    if (!doc) throw new ForbiddenError('Doctor profile does not exist for this account');

    const updated = db.update('doctors', doc.id as string, updates);
    // Invalidate cached doctor records
    await cacheService.invalidate(`doctor:detail:${doc.id}`);
    await cacheService.invalidatePrefix('doctors:list');
    return updated;
  }
}

export const doctorsService = new DoctorsService();
