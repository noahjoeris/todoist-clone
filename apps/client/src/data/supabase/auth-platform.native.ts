import AsyncStorage from '@react-native-async-storage/async-storage';
import { EMAIL_CONFIRMATION_REDIRECT_TO } from './auth-callback';
import type { AuthPlatformOptions } from './auth-platform';

export const authPlatformOptions: AuthPlatformOptions = {
  // Sessions contain refresh tokens; AsyncStorage is the storage Supabase documents for
  // React Native. Consider a secure-store adapter if the threat model changes.
  storage: AsyncStorage,
  // No `window.location` on native: confirmation is completed by `auth-deep-link.native.ts`
  // (`Linking` + `exchangeCodeForSession` / `setSession`), not supabase-js URL detection.
  detectSessionInUrl: false,
  // PKCE puts the grant in `?code=` so Android intents / email clients cannot strip a hash.
  flowType: 'pkce',
  emailRedirectTo: EMAIL_CONFIRMATION_REDIRECT_TO,
};
