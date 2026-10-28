import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './common/observability/logger.js';
import { db } from './infrastructure/database/db.js';
import { OutboxService } from './infrastructure/outbox/outbox.service.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`Amrutam Telemedicine Backend running on port ${env.PORT}`, {
    port: env.PORT,
    environment: env.NODE_ENV,
  });
});

// Outbox background worker loop (Every 5 seconds)
const outboxInterval = setInterval(async () => {
  try {
    const processed = await OutboxService.processPendingEvents(10);
    if (processed > 0) {
      logger.info(`[Outbox Worker] Dispatched ${processed} pending events`);
    }
  } catch (err) {
    logger.error('[Outbox Worker] Error during event processing', { error: (err as Error).message });
  }
}, 5000);

// Graceful Shutdown
async function gracefulShutdown(signal: string) {
  logger.info(`Received ${signal}. Initiating graceful shutdown...`);
  clearInterval(outboxInterval);

  server.close(async () => {
    logger.info('HTTP server closed. Terminating database connections...');
    try {
      await db.close();
      logger.info('Database connections closed cleanly.');
      process.exit(0);
    } catch (err) {
      logger.error('Error closing database pool during shutdown', { error: (err as Error).message });
      process.exit(1);
    }
  });

  // Force close if graceful shutdown exceeds 10 seconds
  setTimeout(() => {
    logger.error('Forced shutdown due to timeout (10s)');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
