import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AuthPlatformOptions } from './auth-platform';

export const authPlatformOptions: AuthPlatformOptions = {
  // Sessions contain refresh tokens; AsyncStorage is the storage Supabase documents for
  // React Native. Consider a secure-store adapter if the threat model changes.
  storage: AsyncStorage,
  // No deep link is registered yet: confirmation links open in the browser and the user
  // signs in with their password afterwards.
  detectSessionInUrl: false,
};
