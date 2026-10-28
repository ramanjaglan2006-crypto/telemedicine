import type { Request, Response, NextFunction } from 'express';
import { env } from '../../config/env.js';
import { TooManyRequestsError } from '../errors/AppError.js';

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const memoryStore = new Map<string, RateLimitEntry>();

export function rateLimiter(options: {
  windowMs?: number;
  maxRequests?: number;
  keyGenerator?: (req: Request) => string;
} = {}) {
  const windowMs = options.windowMs || env.RATE_LIMIT_WINDOW_MS;
  const maxRequests = options.maxRequests || env.RATE_LIMIT_MAX_REQUESTS;
  const keyGen = options.keyGenerator || ((req: Request) => req.user?.userId || req.ip || 'anonymous');

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = keyGen(req);
    const now = Date.now();
    const entry = memoryStore.get(key);

    if (!entry || now > entry.resetTime) {
      memoryStore.set(key, { count: 1, resetTime: now + windowMs });
      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', maxRequests - 1);
      return next();
    }

    if (entry.count >= maxRequests) {
      const retryAfterSeconds = Math.ceil((entry.resetTime - now) / 1000);
      res.setHeader('Retry-After', retryAfterSeconds);
      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', 0);
      throw new TooManyRequestsError(`Rate limit exceeded. Please retry after ${retryAfterSeconds} seconds.`);
    }

    entry.count += 1;
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', maxRequests - entry.count);
    next();
  };
}
