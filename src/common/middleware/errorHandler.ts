import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError.js';
import { logger } from '../observability/logger.js';
import { env } from '../../config/env.js';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = (req.headers['x-request-id'] as string) || 'unknown';

  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error('Operational Server Error', {
        requestId,
        code: err.code,
        message: err.message,
        stack: err.stack,
      });
    } else {
      logger.warn('Client Error', {
        requestId,
        code: err.code,
        message: err.message,
        details: err.details,
      });
    }

    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        requestId,
        details: err.details,
      },
    });
    return;
  }

  // Catch-all for unhandled / non-operational errors
  logger.error('Unhandled Server Exception', {
    requestId,
    name: err.name,
    message: err.message,
    stack: err.stack,
  });

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: env.NODE_ENV === 'production'
        ? 'An unexpected error occurred. Please contact system support.'
        : err.message,
      requestId,
    },
  });
}
