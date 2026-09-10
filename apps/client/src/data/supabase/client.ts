import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SupabaseEnv } from '../../config/env';
import { authStorage } from './auth-storage';

/**
 * Supabase is used on the client for Auth (and later Storage) only.
 * Application data is read and written through the PowerSync repositories, never via PostgREST.
 *
 * Sessions persist across restarts (`authStorage` picks the platform store) and tokens refresh
 * automatically; `registerAuthLifecycle` pauses refresh while a native app is backgrounded.
 * Email verification uses codes typed into the app, so no URL-based session detection.
 */
export function createSupabaseClient(env: SupabaseEnv): SupabaseClient {
  return createClient(env.supabaseUrl, env.supabasePublishableKey, {
    auth: {
      ...(authStorage ? { storage: authStorage } : {}),
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
}
