import express, { type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { db } from './infrastructure/database/db.js';
import { requestTrackingMiddleware } from './common/middleware/requestTracking.js';
import { errorHandler } from './common/middleware/errorHandler.js';
import { metricsRegistry } from './common/observability/metrics.js';
import { NotFoundError } from './common/errors/AppError.js';

// Route imports
import { authRoutes } from './modules/auth/auth.routes.js';
import { usersRoutes } from './modules/users/users.routes.js';
import { doctorsRoutes } from './modules/doctors/doctors.routes.js';
import { availabilityRoutes } from './modules/availability/availability.routes.js';
import { appointmentsRoutes } from './modules/appointments/appointments.routes.js';
import { consultationsRoutes } from './modules/consultations/consultations.routes.js';
import { prescriptionsRoutes } from './modules/prescriptions/prescriptions.routes.js';
import { paymentsRoutes } from './modules/payments/payments.routes.js';
import { searchRoutes } from './modules/search/search.routes.js';
import { adminRoutes } from './modules/admin/admin.routes.js';

export function createApp(): express.Application {
  const app = express();

  // 1. Security & Pre-processing Middlewares
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // 2. Request Tracking & Observability Middleware
  app.use(requestTrackingMiddleware);

  // 3. Health Checks
  app.get('/health/live', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'LIVE', uptimeSeconds: process.uptime() });
  });

  app.get('/health/ready', async (_req: Request, res: Response) => {
    const isDbHealthy = await db.isHealthy();
    if (!isDbHealthy) {
      res.status(503).json({ status: 'NOT_READY', database: 'UNHEALTHY' });
      return;
    }
    res.status(200).json({ status: 'READY', database: 'HEALTHY' });
  });

  // 4. Prometheus Metrics Endpoint
  app.get('/metrics', async (_req: Request, res: Response) => {
    res.setHeader('Content-Type', metricsRegistry.contentType);
    const metrics = await metricsRegistry.metrics();
    res.send(metrics);
  });

  // 4.1 OpenAPI Specification & Interactive Swagger UI Endpoints
  app.get('/api/docs/openapi.json', async (_req: Request, res: Response) => {
    try {
      const { default: openapiSpec } = await import('../docs/openapi.json', { with: { type: 'json' } });
      res.status(200).json(openapiSpec);
    } catch {
      res.status(200).json({ title: 'Amrutam Telemedicine Backend API', version: '1.0.0' });
    }
  });

  app.get('/api/docs', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Amrutam Telemedicine API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>
    body { margin: 0; background: #fafafa; }
    .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: '/api/docs/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis],
      });
    };
  </script>
</body>
</html>`);
  });

  // 5. API v1 Routes Mounting
  const apiRouter = express.Router();
  apiRouter.use('/auth', authRoutes);
  apiRouter.use('/users', usersRoutes);
  apiRouter.use('/doctors', doctorsRoutes);
  apiRouter.use('/availability', availabilityRoutes);
  apiRouter.use('/appointments', appointmentsRoutes);
  apiRouter.use('/consultations', consultationsRoutes);
  apiRouter.use('/prescriptions', prescriptionsRoutes);
  apiRouter.use('/payments', paymentsRoutes);
  apiRouter.use('/search', searchRoutes);
  apiRouter.use('/admin', adminRoutes);

  app.use('/api/v1', apiRouter);

  // 6. 404 Handler
  app.use((_req: Request, _res: Response, next) => {
    next(new NotFoundError('The requested endpoint does not exist'));
  });

  // 7. Centralized Error Handler
  app.use(errorHandler);

  return app;
}
