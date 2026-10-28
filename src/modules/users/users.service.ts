import { db } from '../../infrastructure/database/db.js';
import { NotFoundError, ForbiddenError } from '../../common/errors/AppError.js';
import { encryptField, decryptField } from '../../common/security/crypto.js';

export class UsersService {
  async getMe(userId: string) {
    const user = db.findById('users', userId);
    if (!user) throw new NotFoundError('User not found');

    const profile = db.findOne('profiles', (p) => p.user_id === userId);
    let doctor = null;
    if (user.role === 'DOCTOR') {
      doctor = db.findOne('doctors', (d) => d.user_id === userId);
    }

    let medicalHistory: string | null = null;
    if (profile?.medical_history_encrypted) {
      try {
        medicalHistory = decryptField(profile.medical_history_encrypted as string);
      } catch {
        medicalHistory = '[Decryption failed]';
      }
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      isActive: user.is_active,
      mfaEnabled: user.mfa_enabled,
      profile: profile ? {
        firstName: profile.first_name,
        lastName: profile.last_name,
        phone: profile.phone,
        dateOfBirth: profile.date_of_birth,
        gender: profile.gender,
        address: profile.address,
        medicalHistory,
      } : null,
      doctor: doctor ? {
        id: doctor.id,
        specialization: doctor.specialization,
        licenseNumber: doctor.license_number,
        yearsOfExperience: doctor.years_of_experience,
        bio: doctor.bio,
        consultationFee: doctor.consultation_fee,
        isVerified: doctor.is_verified,
      } : null,
    };
  }

  async updateMe(userId: string, data: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    medicalHistory?: string;
    address?: string;
  }) {
    const profile = db.findOne('profiles', (p) => p.user_id === userId);
    if (!profile) throw new NotFoundError('Profile not found');

    const updates: Record<string, unknown> = {};
    if (data.firstName !== undefined) updates.first_name = data.firstName;
    if (data.lastName !== undefined) updates.last_name = data.lastName;
    if (data.phone !== undefined) updates.phone = data.phone;
    if (data.address !== undefined) updates.address = data.address;
    if (data.medicalHistory !== undefined) {
      updates.medical_history_encrypted = encryptField(data.medicalHistory);
    }

    db.update('profiles', profile.id as string, updates);
    return this.getMe(userId);
  }

  async updateUserStatus(actorUserId: string, targetUserId: string, isActive: boolean) {
    const actor = db.findById('users', actorUserId);
    if (!actor || actor.role !== 'ADMIN') {
      throw new ForbiddenError('Only administrators can modify user status');
    }

    const target = db.findById('users', targetUserId);
    if (!target) throw new NotFoundError('Target user not found');

    db.update('users', targetUserId, { is_active: isActive });

    db.insert('audit_logs', {
      user_id: actorUserId,
      action: isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
      resource_type: 'USER',
      resource_id: targetUserId,
    });

    return { success: true, userId: targetUserId, isActive };
  }
}

export const usersService = new UsersService();
