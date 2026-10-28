import crypto from 'node:crypto';
import { db } from '../../infrastructure/database/db.js';
import { hashPassword, comparePassword, encryptField, decryptField } from '../../common/security/crypto.js';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  type TokenPayload,
} from '../../common/security/jwt.js';
import { generateMfaSecret, verifyMfaToken, type MfaEnrollmentResult } from '../../common/security/mfa.js';
import { BadRequestError, UnauthorizedError, ConflictError } from '../../common/errors/AppError.js';
import { OutboxService } from '../../infrastructure/outbox/outbox.service.js';

export class AuthService {
  async register(data: {
    email: string;
    password: string;
    role: 'PATIENT' | 'DOCTOR' | 'ADMIN';
    firstName: string;
    lastName: string;
    phone?: string;
    doctorProfile?: {
      specialization: string;
      licenseNumber: string;
      yearsOfExperience: number;
      bio?: string;
      consultationFee: number;
    };
  }) {
    const existing = db.findOne('users', (u) => u.email === data.email.toLowerCase());
    if (existing) {
      throw new ConflictError('A user with this email address already exists');
    }

    if (data.role === 'DOCTOR' && !data.doctorProfile) {
      throw new BadRequestError('Doctor profile information is required when registering as a DOCTOR');
    }

    const passwordHash = await hashPassword(data.password);

    return db.transaction(async () => {
      // 1. Create User
      const user = db.insert('users', {
        email: data.email.toLowerCase(),
        password_hash: passwordHash,
        role: data.role,
        is_active: true,
        mfa_enabled: false,
        mfa_secret: null,
      });

      const userId = user.id as string;

      // 2. Create Profile
      db.insert('profiles', {
        user_id: userId,
        first_name: data.firstName,
        last_name: data.lastName,
        phone: data.phone || null,
        medical_history_encrypted: null,
      });

      // 3. Create Doctor entry if DOCTOR
      let doctorId: string | undefined;
      if (data.role === 'DOCTOR' && data.doctorProfile) {
        const doctor = db.insert('doctors', {
          user_id: userId,
          specialization: data.doctorProfile.specialization,
          license_number: data.doctorProfile.licenseNumber,
          years_of_experience: data.doctorProfile.yearsOfExperience,
          bio: data.doctorProfile.bio || null,
          consultation_fee: data.doctorProfile.consultationFee,
          is_verified: true,
        });
        doctorId = doctor.id as string;
      }

      // 4. Audit Log
      db.insert('audit_logs', {
        user_id: userId,
        action: 'USER_REGISTERED',
        resource_type: 'USER',
        resource_id: userId,
        metadata_json: JSON.stringify({ role: data.role }),
      });

      // 5. Outbox Event
      OutboxService.recordEvent('USER_REGISTERED', {
        userId,
        email: data.email,
        role: data.role,
      });

      const tokenPayload: TokenPayload = {
        userId,
        email: user.email as string,
        role: user.role as 'PATIENT' | 'DOCTOR' | 'ADMIN',
      };

      const accessToken = generateAccessToken(tokenPayload);
      const refreshToken = generateRefreshToken(tokenPayload);

      // Store refresh token hash
      const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      db.insert('refresh_tokens', {
        user_id: userId,
        token_hash: tokenHash,
        revoked: false,
        expires_at: expiresAt,
      });

      return {
        user: {
          id: userId,
          email: user.email,
          role: user.role,
          doctorId,
        },
        tokens: {
          accessToken,
          refreshToken,
        },
      };
    });
  }

  async login(data: { email: string; password: string; mfaToken?: string }) {
    const user = db.findOne('users', (u) => u.email === data.email.toLowerCase());
    if (!user) {
      throw new UnauthorizedError('Invalid email or password');
    }

    if (user.is_active === false) {
      throw new UnauthorizedError('Account is disabled. Please contact administrator.');
    }

    const passwordMatch = await comparePassword(data.password, user.password_hash as string);
    if (!passwordMatch) {
      throw new UnauthorizedError('Invalid email or password');
    }

    // MFA Verification if enabled
    if (user.mfa_enabled) {
      if (!data.mfaToken) {
        return {
          mfaRequired: true,
          message: 'MFA token required to complete authentication',
        };
      }

      const decryptedSecret = decryptField(user.mfa_secret as string);
      const isMfaValid = verifyMfaToken(data.mfaToken, decryptedSecret);
      if (!isMfaValid) {
        throw new UnauthorizedError('Invalid multi-factor authentication code');
      }
    }

    const userId = user.id as string;
    const tokenPayload: TokenPayload = {
      userId,
      email: user.email as string,
      role: user.role as 'PATIENT' | 'DOCTOR' | 'ADMIN',
      mfaAuthenticated: user.mfa_enabled as boolean,
    };

    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    // Save refresh token
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    db.insert('refresh_tokens', {
      user_id: userId,
      token_hash: tokenHash,
      revoked: false,
      expires_at: expiresAt,
    });

    db.insert('audit_logs', {
      user_id: userId,
      action: 'USER_LOGIN',
      resource_type: 'USER',
      resource_id: userId,
      metadata_json: JSON.stringify({ mfaUsed: user.mfa_enabled }),
    });

    return {
      mfaRequired: false,
      user: {
        id: userId,
        email: user.email,
        role: user.role,
        mfaEnabled: user.mfa_enabled,
      },
      tokens: {
        accessToken,
        refreshToken,
      },
    };
  }

  async refresh(refreshToken: string) {
    const decoded = verifyRefreshToken(refreshToken);
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

    const session = db.findOne('refresh_tokens', (r) => r.token_hash === tokenHash);
    if (!session || session.revoked === true) {
      // Possible token reuse attack detected! Revoke all tokens for this user
      const userSessions = db.find('refresh_tokens', (r) => r.user_id === decoded.userId);
      for (const s of userSessions) {
        db.update('refresh_tokens', s.id as string, { revoked: true });
      }
      throw new UnauthorizedError('Invalid or revoked refresh token. All sessions revoked for safety.');
    }

    // Revoke old token (Rotation)
    db.update('refresh_tokens', session.id as string, { revoked: true });

    const newPayload: TokenPayload = {
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role,
      mfaAuthenticated: decoded.mfaAuthenticated,
    };

    const newAccessToken = generateAccessToken(newPayload);
    const newRefreshToken = generateRefreshToken(newPayload);

    // Save new rotated refresh token
    const newTokenHash = crypto.createHash('sha256').update(newRefreshToken).digest('hex');
    db.insert('refresh_tokens', {
      user_id: decoded.userId,
      token_hash: newTokenHash,
      revoked: false,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    };
  }

  async logout(refreshToken: string) {
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const session = db.findOne('refresh_tokens', (r) => r.token_hash === tokenHash);
    if (session) {
      db.update('refresh_tokens', session.id as string, { revoked: true });
    }
    return { success: true };
  }

  async enrollMfa(userId: string): Promise<MfaEnrollmentResult> {
    const user = db.findById('users', userId);
    if (!user) throw new UnauthorizedError('User not found');

    const enrollment = await generateMfaSecret(user.email as string);
    // Temporarily save encrypted candidate secret on user record pending verification
    const encryptedSecret = encryptField(enrollment.secret);
    db.update('users', userId, {
      mfa_secret: encryptedSecret,
    });

    return enrollment;
  }

  async verifyAndEnableMfa(userId: string, token: string) {
    const user = db.findById('users', userId);
    if (!user || !user.mfa_secret) {
      throw new BadRequestError('MFA enrollment has not been initiated for this account');
    }

    const secret = decryptField(user.mfa_secret as string);
    const isValid = verifyMfaToken(token, secret);
    if (!isValid) {
      throw new BadRequestError('Invalid MFA verification code');
    }

    db.update('users', userId, {
      mfa_enabled: true,
    });

    db.insert('audit_logs', {
      user_id: userId,
      action: 'MFA_ENABLED',
      resource_type: 'USER',
      resource_id: userId,
    });

    return { success: true, message: 'Multi-factor authentication successfully enabled' };
  }
}

export const authService = new AuthService();
