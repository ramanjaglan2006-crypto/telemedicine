import { logger } from '../../common/observability/logger.js';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class CacheService {
  private memoryStore = new Map<string, CacheEntry<unknown>>();
  private inflightPromises = new Map<string, Promise<unknown>>();

  /**
   * Get cached item or execute fetcher with stampede protection (Promise Coalescing)
   */
  async getOrSet<T>(key: string, ttlSeconds: number, fetcher: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const existing = this.memoryStore.get(key) as CacheEntry<T> | undefined;

    if (existing && existing.expiresAt > now) {
      return existing.value;
    }

    // Cache Stampede Protection: Coalesce concurrent requests for the exact same key
    if (this.inflightPromises.has(key)) {
      return this.inflightPromises.get(key) as Promise<T>;
    }

    const fetchPromise = (async () => {
      try {
        const freshValue = await fetcher();
        this.memoryStore.set(key, {
          value: freshValue,
          expiresAt: Date.now() + ttlSeconds * 1000,
        });
        return freshValue;
      } catch (err) {
        logger.warn('Cache fetcher failed', { key, error: (err as Error).message });
        throw err;
      } finally {
        this.inflightPromises.delete(key);
      }
    })();

    this.inflightPromises.set(key, fetchPromise);
    return fetchPromise;
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.memoryStore.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.memoryStore.delete(key);
      return null;
    }
    return entry.value;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.memoryStore.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  async invalidate(key: string): Promise<void> {
    this.memoryStore.delete(key);
  }

  async invalidatePrefix(prefix: string): Promise<void> {
    for (const key of this.memoryStore.keys()) {
      if (key.startsWith(prefix)) {
        this.memoryStore.delete(key);
      }
    }
  }

  clear(): void {
    this.memoryStore.clear();
    this.inflightPromises.clear();
  }
}

export const cacheService = new CacheService();
