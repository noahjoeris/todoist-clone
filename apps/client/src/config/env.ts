import { z } from 'zod';

// Expo inlines `process.env.EXPO_PUBLIC_*` at build time, so each variable must be
// referenced statically (no dynamic `process.env[name]` lookups).
// Everything here ships to end users: only public configuration belongs in this file.
//
// PowerSync and API URLs are not read yet; they arrive with the first synced table.

const supabaseEnvSchema = z.object({
  supabaseUrl: z.url({ error: 'must be the project URL, e.g. https://<ref>.supabase.co' }),
  supabasePublishableKey: z.string().min(1, { error: 'must not be empty' }),
});

export type SupabaseEnv = z.infer<typeof supabaseEnvSchema>;

/**
 * Supabase is optional: guest tasks work without any cloud configuration.
 *
 * - `unconfigured`: neither variable is set; the app runs in guest-only mode.
 * - `invalid`: something is set but incomplete or malformed. The error is surfaced to
 *   the user while guest tasks keep working.
 * - `configured`: both variables are usable.
 */
export type SupabaseEnvResult =
  | { status: 'unconfigured' }
  | { status: 'invalid'; error: Error }
  | { status: 'configured'; env: SupabaseEnv };

export function loadSupabaseEnv(): SupabaseEnvResult {
  const raw = {
    supabaseUrl: emptyToUndefined(process.env.EXPO_PUBLIC_SUPABASE_URL),
    supabasePublishableKey: emptyToUndefined(process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
  };

  if (raw.supabaseUrl === undefined && raw.supabasePublishableKey === undefined) {
    return { status: 'unconfigured' };
  }

  const result = supabaseEnvSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  ${toEnvName(issue.path)}: ${issue.message}`)
      .join('\n');
    return {
      status: 'invalid',
      error: new Error(
        `Incomplete Supabase configuration (see apps/client/.env.example):\n${issues}`,
      ),
    };
  }

  return { status: 'configured', env: result.data };
}

const ENV_NAMES: Record<keyof SupabaseEnv, string> = {
  supabaseUrl: 'EXPO_PUBLIC_SUPABASE_URL',
  supabasePublishableKey: 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
};

function toEnvName(path: PropertyKey[]): string {
  const key = path[0];
  return typeof key === 'string' && key in ENV_NAMES
    ? ENV_NAMES[key as keyof SupabaseEnv]
    : String(key);
}

// `.env` files may contain `EXPO_PUBLIC_SUPABASE_URL=` with no value; treat that as unset.
function emptyToUndefined(value: string | undefined): string | undefined {
  return value?.trim() ? value.trim() : undefined;
}
