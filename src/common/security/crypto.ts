import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { env } from '../../config/env.js';

const BCRYPT_SALT_ROUNDS = 12;

export async function hashPassword(plainText: string): Promise<string> {
  return bcrypt.hash(plainText, BCRYPT_SALT_ROUNDS);
}

export async function comparePassword(plainText: string, hashed: string): Promise<boolean> {
  return bcrypt.compare(plainText, hashed);
}

/**
 * AES-256-GCM Field-Level Encryption for Sensitive Health Information
 * Format: ivHex:authTagHex:ciphertextHex
 */
export function encryptField(plainText: string): string {
  const key = Buffer.from(env.ENCRYPTION_KEY, 'hex');
  const iv = crypto.randomBytes(12); // Standard 96-bit IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decryptField(encryptedPayload: string): string {
  const parts = encryptedPayload.split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted payload structure');
  }

  const [ivHex, authTagHex, ciphertextHex] = parts;
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error('Malformed encrypted payload tokens');
  }

  const key = Buffer.from(env.ENCRYPTION_KEY, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(ciphertextHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

/**
 * SHA-256 canonical request fingerprint generator for idempotency
 */
export function generateRequestFingerprint(method: string, path: string, body: unknown): string {
  const normalizedBody = body && typeof body === 'object' ? JSON.stringify(body, Object.keys(body).sort()) : '';
  const canonicalString = `${method.toUpperCase()}:${path.toLowerCase()}:${normalizedBody}`;
  return crypto.createHash('sha256').update(canonicalString).digest('hex');
}

/**
 * Timing-safe HMAC-SHA256 signature verification for payment webhooks
 */
export function verifyHmacSignature(payload: string, signature: string, secret: string): boolean {
  try {
    const computed = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const signatureBuffer = Buffer.from(signature, 'hex');
    const computedBuffer = Buffer.from(computed, 'hex');
    
    if (signatureBuffer.length !== computedBuffer.length) {
      return false;
    }
    return crypto.timingSafeEqual(signatureBuffer, computedBuffer);
  } catch {
    return false;
  }
}
