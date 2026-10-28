import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  comparePassword,
  encryptField,
  decryptField,
  generateRequestFingerprint,
  verifyHmacSignature,
} from '../../src/common/security/crypto.js';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from '../../src/common/security/jwt.js';
import { generateMfaSecret, verifyMfaToken } from '../../src/common/security/mfa.js';
import { generateSync } from 'otplib';

describe('Unit: Cryptography & Security Primitives', () => {
  it('should securely hash and verify passwords using bcrypt', async () => {
    const raw = 'SecureP@ssw0rd123!';
    const hashed = await hashPassword(raw);
    expect(hashed).not.toBe(raw);
    expect(hashed).toMatch(/^\$2[aby]\$/);

    const valid = await comparePassword(raw, hashed);
    expect(valid).toBe(true);

    const invalid = await comparePassword('WrongPassword', hashed);
    expect(invalid).toBe(false);
  });

  it('should encrypt and decrypt sensitive health fields with AES-256-GCM', () => {
    const sensitiveMedicalNote = 'Patient diagnosed with chronic hypertension and Vata imbalance.';
    const encrypted = encryptField(sensitiveMedicalNote);
    
    expect(encrypted).not.toBe(sensitiveMedicalNote);
    expect(encrypted.split(':')).toHaveLength(3); // iv:authTag:ciphertext

    const decrypted = decryptField(encrypted);
    expect(decrypted).toBe(sensitiveMedicalNote);
  });

  it('should reject tampered AES-256-GCM ciphertext', () => {
    const encrypted = encryptField('Confidential health records');
    const parts = encrypted.split(':');
    // Tamper with the ciphertext
    const tampered = `${parts[0]}:${parts[1]}:${parts[2]}ab`;
    expect(() => decryptField(tampered)).toThrow();
  });

  it('should generate consistent SHA-256 request fingerprints regardless of JSON key ordering', () => {
    const fp1 = generateRequestFingerprint('POST', '/api/v1/appointments', { a: 1, b: 2 });
    const fp2 = generateRequestFingerprint('POST', '/api/v1/appointments', { b: 2, a: 1 });
    expect(fp1).toBe(fp2);

    const fp3 = generateRequestFingerprint('POST', '/api/v1/appointments', { a: 1, b: 3 });
    expect(fp1).not.toBe(fp3);
  });

  it('should verify HMAC-SHA256 signatures with timing-safe comparison', () => {
    const payload = JSON.stringify({ event: 'payment_intent.succeeded', amount: 500 });
    const secret = 'whsec_test_secret_key';
    const crypto = require('node:crypto');
    const validSignature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

    expect(verifyHmacSignature(payload, validSignature, secret)).toBe(true);
    expect(verifyHmacSignature(payload, 'invalid_signature_hex', secret)).toBe(false);
  });

  it('should generate, sign, and verify JWT access and refresh tokens', () => {
    const payload = {
      userId: 'd9b3f3b2-6c39-4d64-9cf9-95a9479b19df',
      email: 'doctor@amrutam.com',
      role: 'DOCTOR' as const,
    };

    const accessToken = generateAccessToken(payload);
    const decoded = verifyAccessToken(accessToken);
    expect(decoded.userId).toBe(payload.userId);
    expect(decoded.role).toBe('DOCTOR');

    const refreshToken = generateRefreshToken(payload);
    const decodedRefresh = verifyRefreshToken(refreshToken);
    expect(decodedRefresh.userId).toBe(payload.userId);
  });

  it('should generate TOTP MFA secret, QR data URL, and verify valid OTP code', async () => {
    const enrollment = await generateMfaSecret('patient@example.com');
    expect(enrollment.secret).toBeDefined();
    expect(enrollment.otpauthUrl).toContain('otpauth://totp/');
    expect(enrollment.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);

    const validCode = generateSync({ secret: enrollment.secret });
    const isVerified = verifyMfaToken(validCode, enrollment.secret);
    expect(isVerified).toBe(true);

    const invalidCode = verifyMfaToken('000000', enrollment.secret);
    expect(invalidCode).toBe(false);
  });
});
