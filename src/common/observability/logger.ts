import { env } from '../../config/env.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const SENSITIVE_FIELDS = new Set([
  'password',
  'token',
  'authorization',
  'refreshtoken',
  'access_token',
  'secret',
  'encryption_key',
  'cardnumber',
  'cvv',
  'mfa_secret',
]);

function redact(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(redact);
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_FIELDS.has(lowerKey)) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redact(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export class Logger {
  private service = 'amrutam-telemedicine-backend';

  private log(level: LogLevel, message: string, meta: Record<string, unknown> = {}) {
    const payload = {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      environment: env.NODE_ENV,
      message,
      ...redact(meta) as Record<string, unknown>,
    };

    const serialized = JSON.stringify(payload);
    if (level === 'error' || level === 'fatal') {
      console.error(serialized);
    } else if (level === 'warn') {
      console.warn(serialized);
    } else {
      console.log(serialized);
    }
  }

  info(message: string, meta?: Record<string, unknown>) {
    this.log('info', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>) {
    this.log('warn', message, meta);
  }

  error(message: string, meta?: Record<string, unknown>) {
    this.log('error', message, meta);
  }

  debug(message: string, meta?: Record<string, unknown>) {
    if (env.LOG_LEVEL === 'debug' || env.LOG_LEVEL === 'trace') {
      this.log('debug', message, meta);
    }
  }
}

export const logger = new Logger();
