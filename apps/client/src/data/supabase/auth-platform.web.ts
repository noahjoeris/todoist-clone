import type { AuthPlatformOptions } from './auth-platform';

export const authPlatformOptions: AuthPlatformOptions = {
  // supabase-js defaults to `window.localStorage`.
  // Confirmation links redirect to the Site URL with the session in the URL fragment;
  // supabase-js consumes it on load and signs the user in.
  detectSessionInUrl: true,
  // Snapshot the href at composition time, before (or as) supabase-js reads the URL.
  getLocationHref: () => window.location.href,
};
