import { generateSecret, generateURI, verifySync } from 'otplib';
import QRCode from 'qrcode';
import { env } from '../../config/env.js';

export interface MfaEnrollmentResult {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
}

export async function generateMfaSecret(userEmail: string): Promise<MfaEnrollmentResult> {
  const secret = generateSecret();
  const otpauthUrl = generateURI({
    issuer: env.MFA_SERVICE_NAME,
    label: userEmail,
    secret,
  });

  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

  return {
    secret,
    otpauthUrl,
    qrCodeDataUrl,
  };
}

export function verifyMfaToken(token: string, secret: string): boolean {
  try {
    const result = verifySync({ token: token.trim(), secret });
    return result.valid === true;
  } catch {
    return false;
  }
}
