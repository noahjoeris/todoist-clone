/**
 * Listens for the native confirmation deep link and hands the URL to the auth repository.
 *
 * Metro resolves `./auth-deep-link` to `auth-deep-link.native.ts` (`Linking`) or
 * `auth-deep-link.web.ts` (no-op: supabase-js `detectSessionInUrl` already consumes the
 * Site URL fragment). This file exists so TypeScript has a single declaration to
 * type-check against; it must never be bundled.
 */
export type RegisterAuthDeepLink = (onUrl: (url: string) => Promise<boolean>) => () => void;

export const registerAuthDeepLink: RegisterAuthDeepLink = () => {
  throw new Error(
    'registerAuthDeepLink was resolved without a platform suffix; expected .native.ts or .web.ts',
  );
};
