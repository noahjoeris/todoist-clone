import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SupportedStorage } from '@supabase/supabase-js';

// Sessions contain refresh tokens; AsyncStorage is the storage Supabase documents for
// React Native. Consider a secure-store adapter if the threat model changes.
export const authStorage: SupportedStorage | undefined = AsyncStorage;
