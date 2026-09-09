import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit does not load env files. Read the repo-root .env when present so
// `pnpm db:migrate` works locally; CI and containers set env vars directly.
const rootEnvFile = resolve(import.meta.dirname, '../../.env');
if (existsSync(rootEnvFile)) {
  process.loadEnvFile(rootEnvFile);
}

const migrationDatabaseUrl = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
if (!migrationDatabaseUrl) {
  throw new Error('DATABASE_MIGRATION_URL or DATABASE_URL must be set to run drizzle-kit');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url: migrationDatabaseUrl },
  // Supabase owns auth/storage/etc. Drizzle only manages the application schema.
  schemaFilter: ['public'],
  strict: true,
  verbose: true,
});
