import { z } from 'zod';

// Expo inlines `process.env.EXPO_PUBLIC_*` at build time, so each variable must be
// referenced statically (no dynamic `process.env[name]` lookups).
// Everything here ships to end users: only public configuration belongs in this file.
const publicEnvSchema = z.object({
  supabaseUrl: z.url(),
  supabasePublishableKey: z.string().min(1),
  powersyncUrl: z.url(),
  apiUrl: z.url(),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

export function loadPublicEnv(): PublicEnv {
  const result = publicEnvSchema.safeParse({
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabasePublishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    powersyncUrl: process.env.EXPO_PUBLIC_POWERSYNC_URL,
    apiUrl: process.env.EXPO_PUBLIC_API_URL,
  });

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Missing or invalid EXPO_PUBLIC_* configuration (see apps/client/.env.example):\n${issues}`,
    );
  }

  return result.data;
}
