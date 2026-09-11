import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit does not load env files. Read the repo-root .env when present so
// `pnpm db:migrate` works locally; CI and containers set env vars directly.
// `import.meta.dirname` is missing when drizzle-kit bundles this config.
const configDir = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
const rootEnvFile = resolve(configDir, '../../.env');
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
