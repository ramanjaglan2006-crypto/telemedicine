import client from 'prom-client';

// Collect standard Node.js / process runtime metrics
client.collectDefaultMetrics({ prefix: 'amrutam_' });

// HTTP Request Metrics (Low-cardinality labels only)
export const httpRequestCounter = new client.Counter({
  name: 'amrutam_http_requests_total',
  help: 'Total count of incoming HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
});

export const httpRequestDurationHistogram = new client.Histogram({
  name: 'amrutam_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 1, 2, 5],
});

// Business Workflow Metrics
export const bookingOperationsCounter = new client.Counter({
  name: 'amrutam_booking_operations_total',
  help: 'Total count of appointment booking operations by outcome',
  labelNames: ['outcome'], // 'success' | 'conflict_double_booking' | 'slot_unavailable' | 'error'
});

export const idempotencyCounter = new client.Counter({
  name: 'amrutam_idempotency_hits_total',
  help: 'Total count of requests processed by idempotency layer',
  labelNames: ['result'], // 'fresh_execution' | 'cached_replay' | 'concurrent_in_progress' | 'payload_mismatch'
});

export const paymentEventsCounter = new client.Counter({
  name: 'amrutam_payment_events_total',
  help: 'Total count of payment webhook events received',
  labelNames: ['event_type', 'status'], // 'payment_intent.succeeded', etc.
});

export const metricsRegistry = client.register;
