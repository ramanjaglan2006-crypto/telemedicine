import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { env } from '../../config/env.js';
import { logger } from '../../common/observability/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const ddl = fs.readFileSync(schemaPath, 'utf8');

  logger.info('Connecting to PostgreSQL to execute migrations...', {
    databaseUrl: env.DATABASE_URL.replace(/:[^:@]+@/, ':***@'),
  });

  const client = new pg.Client({
    connectionString: env.DATABASE_URL,
  });

  try {
    await client.connect();
    logger.info('Connected to PostgreSQL. Executing DDL statements...');
    await client.query(ddl);
    logger.info('Migrations applied successfully!');
  } catch (err) {
    logger.error('Failed to run PostgreSQL migrations', { error: (err as Error).message });
    throw err;
  } finally {
    await client.end();
  }
}

if (process.argv[1]?.endsWith('migrate.ts') || process.argv[1]?.endsWith('migrate.js')) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
