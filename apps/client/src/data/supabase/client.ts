import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SupabaseEnv } from '../../config/env';
import { authPlatformOptions } from './auth-platform';

/**
 * Supabase is used on the client for Auth (and later Storage) only.
 * Application data is read and written through the PowerSync repositories, never via PostgREST.
 *
 * Sessions persist across restarts and tokens refresh automatically; `registerAuthLifecycle`
 * pauses refresh while a native app is backgrounded. Email confirmation happens through the
 * link in Supabase's default email; the web app picks the resulting session up from the URL.
 */
export function createSupabaseClient(env: SupabaseEnv): SupabaseClient {
  const { storage, detectSessionInUrl } = authPlatformOptions;
  return createClient(env.supabaseUrl, env.supabasePublishableKey, {
    auth: {
      ...(storage ? { storage } : {}),
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl,
    },
  });
}
