import type { SupportedStorage } from '@supabase/supabase-js';

/**
 * Where Supabase persists the auth session.
 *
 * Metro resolves `./auth-storage` to `auth-storage.native.ts` on iOS/Android (AsyncStorage)
 * and to `auth-storage.web.ts` on web (`undefined`: supabase-js falls back to
 * `window.localStorage`). This file exists so TypeScript has a single declaration to
 * type-check against; it must never be bundled.
 */
export const authStorage: SupportedStorage | undefined = undefined;
