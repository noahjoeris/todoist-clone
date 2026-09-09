import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Comma-separated list of allowed origins, or `*`. */
  CORS_ORIGIN: z.string().default('*'),

  /** Postgres connection string for the application runtime role (via Supavisor in Supabase). */
  DATABASE_URL: z.url(),

  /** Supabase project URL, used to verify user JWTs and call Supabase APIs server-side. */
  SUPABASE_URL: z.url(),
  /** Supabase secret (service role) key. Server-only, never shipped to clients. */
  SUPABASE_SECRET_KEY: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

export function parseCorsOrigin(value: string): string | string[] {
  if (value === '*') return '*';
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}
