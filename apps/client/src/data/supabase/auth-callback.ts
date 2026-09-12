import type { Session, SupabaseClient } from '@supabase/supabase-js';

/** Custom-scheme URL confirmation emails redirect to on native. Allow-listed in GoTrue. */
export const EMAIL_CONFIRMATION_REDIRECT_TO = 'todoist-clone://auth/callback';

export type AuthCallback =
  | { kind: 'code'; code: string }
  | { kind: 'tokens'; accessToken: string; refreshToken: string };

type AuthCallbackClient = Pick<SupabaseClient['auth'], 'exchangeCodeForSession' | 'setSession'>;

/**
 * Reads a PKCE `code` or implicit `access_token`/`refresh_token` out of a confirmation
 * deep link. Unrelated URLs, malformed strings, and error redirects yield `null`.
 */
export function parseAuthCallbackUrl(url: string): AuthCallback | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!isAuthCallbackUrl(parsed)) return null;

  const params = callbackParams(parsed);
  const code = nonempty(params.get('code'));
  if (code) return { kind: 'code', code };

  const accessToken = nonempty(params.get('access_token'));
  const refreshToken = nonempty(params.get('refresh_token'));
  if (accessToken && refreshToken) {
    return { kind: 'tokens', accessToken, refreshToken };
  }
  return null;
}

/**
 * Exchanges a confirmation deep link for a Supabase session. `null` means the URL is not
 * an auth callback (or has no credentials). Auth API failures throw.
 */
export async function createSessionFromAuthUrl(
  auth: AuthCallbackClient,
  url: string,
): Promise<Session | null> {
  const callback = parseAuthCallbackUrl(url);
  if (!callback) return null;
  if (callback.kind === 'code') {
    const { data, error } = await auth.exchangeCodeForSession(callback.code);
    if (error) throw error;
    return data.session;
  }
  const { data, error } = await auth.setSession({
    access_token: callback.accessToken,
    refresh_token: callback.refreshToken,
  });
  if (error) throw error;
  return data.session;
}

function isAuthCallbackUrl(url: URL): boolean {
  if (url.protocol !== 'todoist-clone:') return false;
  const host = url.hostname;
  const path = url.pathname.replace(/\/+$/, '');
  const combined = host ? `${host}${path}` : path.replace(/^\//, '');
  return combined === 'auth/callback';
}

function callbackParams(url: URL): URLSearchParams {
  const params = new URLSearchParams(url.search);
  const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
  if (hash) {
    const hashParams = new URLSearchParams(hash);
    for (const [key, value] of hashParams) {
      if (!params.has(key)) params.set(key, value);
    }
  }
  return params;
}

function nonempty(value: string | null): string | null {
  if (value == null || value.length === 0) return null;
  return value;
}
