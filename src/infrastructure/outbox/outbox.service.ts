import { db } from '../database/db.js';
import { logger } from '../../common/observability/logger.js';

export interface OutboxEvent {
  id: string;
  event_type: string;
  payload_json: string;
  status: 'PENDING' | 'PROCESSED' | 'FAILED';
  retry_count: number;
  created_at: Date;
  updated_at: Date;
}

export class OutboxService {
  /**
   * Publish an event into the Outbox table (must be called inside business workflow)
   */
  static recordEvent(eventType: string, payload: Record<string, unknown>): string {
    const record = db.insert('outbox_events', {
      event_type: eventType,
      payload_json: JSON.stringify(payload),
      status: 'PENDING',
      retry_count: 0,
    });
    return record.id as string;
  }

  /**
   * Process pending outbox events asynchronously
   */
  static async processPendingEvents(batchSize = 10): Promise<number> {
    const pendingEvents = db
      .find('outbox_events', (e) => e.status === 'PENDING')
      .slice(0, batchSize) as unknown as OutboxEvent[];

    let processedCount = 0;

    for (const event of pendingEvents) {
      try {
        const payload = JSON.parse(event.payload_json);
        logger.info(`[Outbox] Dispatching event: ${event.event_type}`, {
          eventId: event.id,
          payload,
        });

        // Simulate asynchronous notification dispatch (email, SMS, audit aggregator)
        // Mark as PROCESSED
        db.update('outbox_events', event.id, {
          status: 'PROCESSED',
        });
        processedCount += 1;
      } catch (err) {
        logger.error(`[Outbox] Failed processing event: ${event.event_type}`, {
          eventId: event.id,
          error: (err as Error).message,
        });

        const retryCount = (event.retry_count || 0) + 1;
        db.update('outbox_events', event.id, {
          retry_count: retryCount,
          status: retryCount >= 5 ? 'FAILED' : 'PENDING',
        });
      }
    }

    return processedCount;
  }
}
