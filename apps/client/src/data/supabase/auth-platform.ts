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
   * Current page URL so confirmation/recovery error params can be parsed before
   * supabase-js consumes them. Web only; native deep links are a separate issue.
   */
  getLocationHref?: () => string;
}

export const authPlatformOptions: AuthPlatformOptions = {
  detectSessionInUrl: false,
};
