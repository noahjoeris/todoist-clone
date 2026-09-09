import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { PublicEnv } from '../../config/env';

/**
 * Supabase is used on the client for Auth (and later Storage) only.
 * Application data is read and written through the PowerSync repositories, never via PostgREST.
 */
export function createSupabaseClient(env: PublicEnv): SupabaseClient {
  return createClient(env.supabaseUrl, env.supabasePublishableKey, {
    auth: {
      // Session persistence is platform-specific and wired up together with the auth flow.
      persistSession: false,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
}
