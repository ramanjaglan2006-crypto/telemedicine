/**
 * Bounded Retry Utility with Exponential Backoff and Full Jitter
 * Prevents retry storms and handles transient database/network errors
 */

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  shouldRetry?: (error: Error) => boolean;
}

export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 100,
    maxDelayMs = 2000,
    factor = 2,
    shouldRetry = () => true,
  } = options;

  let attempt = 0;

  while (true) {
    try {
      attempt += 1;
      return await operation(attempt);
    } catch (error) {
      const err = error as Error;
      if (attempt >= maxRetries || !shouldRetry(err)) {
        throw err;
      }

      // Calculate exponential backoff with full randomized jitter: random(0, min(maxDelay, initialDelay * factor^(attempt - 1)))
      const calculatedDelay = Math.min(maxDelayMs, initialDelayMs * Math.pow(factor, attempt - 1));
      const jitteredDelay = Math.floor(Math.random() * calculatedDelay);

      await new Promise((resolve) => setTimeout(resolve, jitteredDelay));
    }
  }
}
