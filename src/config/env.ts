import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  
  DATABASE_URL: z.string().default('postgresql://postgres:postgres@localhost:5432/amrutam_telemed'),
  DATABASE_TEST_URL: z.string().default('postgresql://postgres:postgres@localhost:5432/amrutam_telemed_test'),
  DATABASE_POOL_MIN: z.coerce.number().default(2),
  DATABASE_POOL_MAX: z.coerce.number().default(20),

  JWT_ACCESS_SECRET: z.string().min(32).default('c1e87903fbbcf49d2822a16d849206d203df4401c34a9914df5a8bf19416551b'),
  JWT_REFRESH_SECRET: z.string().min(32).default('7f94bb2e20ff9c016cf774bf9129d3c5092a4066928e46955c45e89a531cf5c9'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  MFA_SERVICE_NAME: z.string().default('Amrutam Telemedicine'),

  // 32-byte hex string (64 characters) for AES-256-GCM
  ENCRYPTION_KEY: z.string().length(64).default('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'),

  WEBHOOK_SECRET_STRIPE: z.string().default('whsec_mock_stripe_webhook_secret_key_123'),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(120),
  CORS_ORIGIN: z.string().default('*'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const errorDetails = (result.error.issues || []).map((e: z.ZodIssue) => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new Error(`[Configuration Error] Invalid environment variables: ${errorDetails}`);
  }
  return result.data;
}

export const env = loadEnv();
