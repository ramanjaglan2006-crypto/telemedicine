import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../observability/logger.js';
import { httpRequestCounter, httpRequestDurationHistogram } from '../observability/metrics.js';

export function requestTrackingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = (req.header('X-Request-Id') as string) || uuidv4();
  req.headers['x-request-id'] = requestId;
  res.setHeader('X-Request-Id', requestId);

  const startTime = process.hrtime();

  res.on('finish', () => {
    const diff = process.hrtime(startTime);
    const durationSeconds = diff[0] + diff[1] / 1e9;
    const durationMs = (durationSeconds * 1000).toFixed(2);

    const route = req.route ? (req.baseUrl + req.route.path) : req.path;
    const statusCode = res.statusCode.toString();

    // Instrument metrics
    httpRequestCounter.inc({
      method: req.method,
      route,
      status_code: statusCode,
    });

    httpRequestDurationHistogram.observe(
      {
        method: req.method,
        route,
        status_code: statusCode,
      },
      durationSeconds
    );

    // Structured logging
    logger.info('HTTP Request processed', {
      requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: `${durationMs}ms`,
      ip: req.ip,
      userAgent: req.header('user-agent'),
    });
  });

  next();
}
