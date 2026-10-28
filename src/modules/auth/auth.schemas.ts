import { z } from 'zod';

export const registerSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address').max(255),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    role: z.enum(['PATIENT', 'DOCTOR', 'ADMIN']).default('PATIENT'),
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    phone: z.string().optional(),
    // Optional Doctor details if registering as DOCTOR
    doctorProfile: z.object({
      specialization: z.string().min(2),
      licenseNumber: z.string().min(3),
      yearsOfExperience: z.number().int().min(0).default(0),
      bio: z.string().optional(),
      consultationFee: z.number().positive().default(500),
    }).optional(),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(1),
    mfaToken: z.string().length(6).optional(),
  }),
});

export const refreshSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1),
  }),
});

export const mfaVerifySchema = z.object({
  body: z.object({
    mfaToken: z.string().length(6, 'MFA code must be exactly 6 digits'),
  }),
});

export const passwordResetSchema = z.object({
  body: z.object({
    oldPassword: z.string().min(1),
    newPassword: z.string().min(8),
  }),
});
