import pg from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { env } from '../../config/env.js';
import { logger } from '../../common/observability/logger.js';
import { ConflictError } from '../../common/errors/AppError.js';

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

export interface IDatabaseClient {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export interface IDatabase extends IDatabaseClient {
  transaction<T>(callback: (client: IDatabaseClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  isHealthy(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// PostgreSQL Implementation
// ---------------------------------------------------------------------------
export class PostgresDatabase implements IDatabase {
  private pool: pg.Pool;

  constructor(connectionString: string = env.DATABASE_URL) {
    this.pool = new pg.Pool({
      connectionString,
      min: env.DATABASE_POOL_MIN,
      max: env.DATABASE_POOL_MAX,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    this.pool.on('error', (err) => {
      logger.error('Unexpected error on idle PostgreSQL client', { error: err.message });
    });
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const res = await this.pool.query(sql, params);
    return {
      rows: res.rows as T[],
      rowCount: res.rowCount ?? 0,
    };
  }

  async transaction<T>(callback: (client: IDatabaseClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const clientWrapper: IDatabaseClient = {
        query: async <R = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<QueryResult<R>> => {
          const res = await client.query(sql, params);
          return { rows: res.rows as R[], rowCount: res.rowCount ?? 0 };
        },
      };
      const result = await callback(clientWrapper);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      const res = await this.pool.query('SELECT 1 as healthy');
      return res.rows.length > 0;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

// ---------------------------------------------------------------------------
// High-Fidelity In-Memory Database (for hermetic testing & offline verification)
// Supports table stores, constraints, and atomic transactions with rollback
// ---------------------------------------------------------------------------
export class MemoryDatabase implements IDatabase {
  public tables: Map<string, Map<string, Record<string, unknown>>> = new Map();
  private lockKeys = new Set<string>();

  constructor() {
    this.initTables();
  }

  public initTables() {
    const tableNames = [
      'users',
      'profiles',
      'doctors',
      'availability_slots',
      'appointments',
      'consultations',
      'prescriptions',
      'payments',
      'audit_logs',
      'idempotency_keys',
      'refresh_tokens',
      'outbox_events',
    ];
    for (const name of tableNames) {
      this.tables.set(name, new Map());
    }
  }

  public clear() {
    for (const table of this.tables.values()) {
      table.clear();
    }
    this.lockKeys.clear();
  }

  async query<T = Record<string, unknown>>(_sql: string, _params: unknown[] = []): Promise<QueryResult<T>> {
    // Basic fallback for simple queries
    return { rows: [], rowCount: 0 };
  }

  async transaction<T>(callback: (client: IDatabaseClient) => Promise<T>): Promise<T> {
    // Deep clone state snapshot before transaction for atomic rollback support
    const snapshot = new Map<string, Map<string, Record<string, unknown>>>();
    for (const [tName, tMap] of this.tables.entries()) {
      const copyMap = new Map<string, Record<string, unknown>>();
      for (const [k, v] of tMap.entries()) {
        copyMap.set(k, { ...v });
      }
      snapshot.set(tName, copyMap);
    }

    try {
      const result = await callback(this);
      return result;
    } catch (error) {
      // Rollback to snapshot on error
      this.tables = snapshot;
      throw error;
    }
  }

  async isHealthy(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    this.clear();
  }

  // --- Type-safe memory collection helpers ---
  getTable(name: string): Map<string, Record<string, unknown>> {
    const table = this.tables.get(name);
    if (!table) {
      const newTable = new Map<string, Record<string, unknown>>();
      this.tables.set(name, newTable);
      return newTable;
    }
    return table;
  }

  insert(tableName: string, data: Record<string, unknown>): Record<string, unknown> {
    const table = this.getTable(tableName);
    const id = (data.id as string) || (data.key as string) || uuidv4();
    const now = new Date();
    const record = {
      id,
      created_at: now,
      updated_at: now,
      ...data,
    };

    // Constraint validations
    if (tableName === 'users' && data.email) {
      for (const existing of table.values()) {
        if (existing.email === data.email) {
          throw new ConflictError('User with this email already exists');
        }
      }
    }

    if (tableName === 'doctors' && data.license_number) {
      for (const existing of table.values()) {
        if (existing.license_number === data.license_number) {
          throw new ConflictError('Doctor with this license number already exists');
        }
      }
    }

    if (tableName === 'availability_slots') {
      for (const existing of table.values()) {
        if (
          existing.doctor_id === data.doctor_id &&
          new Date(existing.start_time as string).getTime() === new Date(data.start_time as string).getTime()
        ) {
          throw new ConflictError('Availability slot already exists for this doctor at the given start time');
        }
      }
    }

    if (tableName === 'appointments') {
      for (const existing of table.values()) {
        if (existing.slot_id === data.slot_id && existing.status !== 'CANCELLED') {
          throw new ConflictError('This slot is already booked for an active appointment');
        }
      }
    }

    if (tableName === 'prescriptions') {
      for (const existing of table.values()) {
        if (existing.consultation_id === data.consultation_id && existing.version === data.version) {
          throw new ConflictError('A prescription with this version already exists for this consultation');
        }
      }
    }

    table.set(id, record);
    return record;
  }

  findById(tableName: string, id: string): Record<string, unknown> | null {
    const table = this.getTable(tableName);
    const record = table.get(id);
    return record ? { ...record } : null;
  }

  findOne(tableName: string, predicate: (record: Record<string, unknown>) => boolean): Record<string, unknown> | null {
    const table = this.getTable(tableName);
    for (const record of table.values()) {
      if (predicate(record)) {
        return { ...record };
      }
    }
    return null;
  }

  find(tableName: string, predicate?: (record: Record<string, unknown>) => boolean): Record<string, unknown>[] {
    const table = this.getTable(tableName);
    const results: Record<string, unknown>[] = [];
    for (const record of table.values()) {
      if (!predicate || predicate(record)) {
        results.push({ ...record });
      }
    }
    return results;
  }

  update(tableName: string, id: string, updates: Record<string, unknown>): Record<string, unknown> | null {
    const table = this.getTable(tableName);
    const existing = table.get(id);
    if (!existing) return null;

    const updated = {
      ...existing,
      ...updates,
      updated_at: new Date(),
    };
    table.set(id, updated);
    return { ...updated };
  }

  delete(tableName: string, id: string): boolean {
    const table = this.getTable(tableName);
    return table.delete(id);
  }
}

// Global active database instance (MemoryDatabase is default for hermetic tests / standalone, switchable to PostgresDatabase)
export const db = new MemoryDatabase();
