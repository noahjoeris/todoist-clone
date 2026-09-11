import type { SupportedStorage } from '@supabase/supabase-js';

/**
 * Platform-specific parts of the Supabase auth configuration.
 *
 * Metro resolves `./auth-platform` to `auth-platform.native.ts` on iOS/Android and to
 * `auth-platform.web.ts` on web. This file exists so TypeScript has a single declaration to
 * type-check against; it must never be bundled.
 */
export interface AuthPlatformOptions {
  /** Where sessions persist. `undefined` lets supabase-js use `window.localStorage`. */
  storage?: SupportedStorage;
  /** Whether to pick up a session from the page URL after an email confirmation redirect. */
  detectSessionInUrl: boolean;
  /**
   * Native uses PKCE so confirmation redirects carry `?code=` (query survives Linking).
   * Omitted on web so supabase-js stays on the implicit grant + `detectSessionInUrl`.
   */
  flowType?: 'pkce' | 'implicit';
  /** Native confirmation emails redirect here. Omitted on web (Site URL + `detectSessionInUrl`). */
  emailRedirectTo?: string;
  /**
   * Current page URL so confirmation/recovery error params can be parsed before
   * supabase-js consumes them. Web only; native deep-link errors go through the callback exchange.
   */
  getLocationHref?: () => string;
}

export const authPlatformOptions: AuthPlatformOptions = {
  detectSessionInUrl: false,
};
