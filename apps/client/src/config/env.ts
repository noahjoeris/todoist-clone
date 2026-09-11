import { z } from 'zod';

// Expo inlines `process.env.EXPO_PUBLIC_*` at build time, so each variable must be
// referenced statically (no dynamic `process.env[name]` lookups).
// Everything here ships to end users: only public configuration belongs in this file.

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

const cloudEnvSchema = z.object({
  supabaseUrl: z.url({ error: 'must be the project URL, e.g. https://<ref>.supabase.co' }),
  supabasePublishableKey: z.string().min(1, { error: 'must not be empty' }),
  powersyncUrl: z.url({ error: 'must be the PowerSync instance URL' }),
  apiUrl: z
    .url({ error: 'must be the API origin, e.g. http://localhost:3000' })
    .transform(stripTrailingSlashes),
});

export type CloudEnv = z.infer<typeof cloudEnvSchema>;

/**
 * Cloud services are optional: guest tasks work without any configuration.
 *
 * - `unconfigured`: none of the four variables is set; the app runs in guest-only mode.
 * - `invalid`: something is set but incomplete or malformed. The error is surfaced to
 *   the user while guest tasks keep working.
 * - `configured`: all four variables are usable (Supabase Auth, PowerSync, Fastify API).
 */
export type CloudEnvResult =
  | { status: 'unconfigured' }
  | { status: 'invalid'; error: Error }
  | { status: 'configured'; env: CloudEnv };

export function loadCloudEnv(): CloudEnvResult {
  const raw = {
    supabaseUrl: emptyToUndefined(process.env.EXPO_PUBLIC_SUPABASE_URL),
    supabasePublishableKey: emptyToUndefined(process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
    powersyncUrl: emptyToUndefined(process.env.EXPO_PUBLIC_POWERSYNC_URL),
    apiUrl: emptyToUndefined(process.env.EXPO_PUBLIC_API_URL),
  };

  if (
    raw.supabaseUrl === undefined &&
    raw.supabasePublishableKey === undefined &&
    raw.powersyncUrl === undefined &&
    raw.apiUrl === undefined
  ) {
    return { status: 'unconfigured' };
  }

  const result = cloudEnvSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  ${toEnvName(issue.path)}: ${issue.message}`)
      .join('\n');
    return {
      status: 'invalid',
      error: new Error(`Incomplete cloud configuration (see apps/client/.env.example):\n${issues}`),
    };
  }

  return { status: 'configured', env: result.data };
}

const ENV_NAMES: Record<keyof CloudEnv, string> = {
  supabaseUrl: 'EXPO_PUBLIC_SUPABASE_URL',
  supabasePublishableKey: 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  powersyncUrl: 'EXPO_PUBLIC_POWERSYNC_URL',
  apiUrl: 'EXPO_PUBLIC_API_URL',
};

function toEnvName(path: PropertyKey[]): string {
  const key = path[0];
  return typeof key === 'string' && key in ENV_NAMES
    ? ENV_NAMES[key as keyof CloudEnv]
    : String(key);
}

// `.env` files may contain `EXPO_PUBLIC_SUPABASE_URL=` with no value; treat that as unset.
function emptyToUndefined(value: string | undefined): string | undefined {
  return value?.trim() ? value.trim() : undefined;
}
