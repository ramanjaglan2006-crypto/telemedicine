import type { Request, Response, NextFunction } from 'express';
import { db } from '../../infrastructure/database/db.js';
import { generateRequestFingerprint } from '../security/crypto.js';
import { ConflictError, UnprocessableEntityError } from '../errors/AppError.js';
import { idempotencyCounter } from '../observability/metrics.js';

export interface IdempotencyRecord {
  key: string;
  user_id: string;
  request_fingerprint: string;
  status: 'PENDING' | 'RESOLVED' | 'FAILED';
  response_code: number | null;
  response_body: string | null;
  resource_id: string | null;
  expires_at: Date;
  created_at: Date;
}

const DEFAULT_TTL_HOURS = 24;

export class IdempotencyManager {
  static async checkOrLock(
    key: string,
    userId: string,
    method: string,
    path: string,
    body: unknown
  ): Promise<{ status: 'PROCEED' | 'REPLAY'; record?: IdempotencyRecord }> {
    const fingerprint = generateRequestFingerprint(method, path, body);
    const existing = db.findOne('idempotency_keys', (r) => r.key === key) as unknown as IdempotencyRecord | null;

    if (existing) {
      // Check expiration
      if (new Date(existing.expires_at).getTime() < Date.now()) {
        db.delete('idempotency_keys', key);
      } else {
        // Enforce same payload fingerprint
        if (existing.request_fingerprint !== fingerprint) {
          idempotencyCounter.inc({ result: 'payload_mismatch' });
          throw new UnprocessableEntityError(
            'Idempotency key was previously used with a different request payload or endpoint'
          );
        }

        // Concurrent request currently in progress
        if (existing.status === 'PENDING') {
          idempotencyCounter.inc({ result: 'concurrent_in_progress' });
          throw new ConflictError(
            'An operation with this idempotency key is already in progress. Please retry shortly.'
          );
        }

        // Successfully resolved earlier -> Replay stored outcome
        if (existing.status === 'RESOLVED') {
          idempotencyCounter.inc({ result: 'cached_replay' });
          return { status: 'REPLAY', record: existing };
        }
      }
    }

    // Fresh execution: lock key with PENDING status
    const expiresAt = new Date(Date.now() + DEFAULT_TTL_HOURS * 60 * 60 * 1000);
    db.insert('idempotency_keys', {
      key,
      user_id: userId,
      request_fingerprint: fingerprint,
      status: 'PENDING',
      response_code: null,
      response_body: null,
      resource_id: null,
      expires_at: expiresAt,
    });

    idempotencyCounter.inc({ result: 'fresh_execution' });
    return { status: 'PROCEED' };
  }

  static async resolve(key: string, statusCode: number, responseBody: unknown, resourceId?: string): Promise<void> {
    db.update('idempotency_keys', key, {
      status: 'RESOLVED',
      response_code: statusCode,
      response_body: typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody),
      resource_id: resourceId ?? null,
    });
  }

  static async fail(key: string): Promise<void> {
    db.update('idempotency_keys', key, {
      status: 'FAILED',
    });
  }
}

/**
 * Express Middleware for Idempotency
 * Automatically intercepts Idempotency-Key header on mutating operations (POST, PUT, PATCH)
 */
export function idempotencyMiddleware(options: { required?: boolean } = {}) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = req.header('Idempotency-Key');
    if (!key) {
      if (options.required) {
        res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_IDEMPOTENCY_KEY',
            message: 'Idempotency-Key header is required for this operation',
          },
        });
        return;
      }
      return next();
    }

    // Extract authenticated user ID or fallback to anonymous IP tenant
    const userId = (req as unknown as { user?: { userId: string } }).user?.userId || req.ip || 'anonymous';

    try {
      const lockResult = await IdempotencyManager.checkOrLock(
        key,
        userId,
        req.method,
        req.baseUrl + req.path,
        req.body
      );

      if (lockResult.status === 'REPLAY' && lockResult.record) {
        res.setHeader('X-Idempotent-Replay', 'true');
        const statusCode = lockResult.record.response_code || 200;
        const parsedBody = lockResult.record.response_body
          ? JSON.parse(lockResult.record.response_body)
          : {};
        res.status(statusCode).json(parsedBody);
        return;
      }

      // Intercept res.send/res.json to record response on completion
      const originalJson = res.json.bind(res);
      res.json = (body: unknown): Response => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          IdempotencyManager.resolve(key, res.statusCode, body).catch(() => {});
        } else {
          IdempotencyManager.fail(key).catch(() => {});
        }
        return originalJson(body);
      };

      next();
    } catch (err) {
      next(err);
    }
  };
}
