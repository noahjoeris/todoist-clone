import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { CloudEnv } from '../../config/env';
import { type AuthPlatformOptions, authPlatformOptions } from './auth-platform';

/** Maps platform auth options to the `auth` object passed to `createClient`. */
export function createSupabaseAuthConfig(platform: AuthPlatformOptions) {
  const { storage, detectSessionInUrl, flowType } = platform;
  return {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl,
    ...(storage ? { storage } : {}),
    ...(flowType ? { flowType } : {}),
  };
}

/**
 * Supabase is used on the client for Auth (and later Storage) only.
 * Application data is read and written through the PowerSync repositories, never via PostgREST.
 *
 * Sessions persist across restarts and tokens refresh automatically; `registerAuthLifecycle`
 * pauses refresh while a native app is backgrounded. Email confirmation happens through the
 * link in Supabase's default email. Web picks the session up from the Site URL fragment;
 * native exchanges `todoist-clone://auth/callback` for a session.
 */
export function createSupabaseClient(
  env: Pick<CloudEnv, 'supabaseUrl' | 'supabasePublishableKey'>,
): SupabaseClient {
  return createClient(env.supabaseUrl, env.supabasePublishableKey, {
    auth: createSupabaseAuthConfig(authPlatformOptions),
  });
}
