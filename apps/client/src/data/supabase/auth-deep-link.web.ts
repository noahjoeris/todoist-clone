import type { RegisterAuthDeepLink } from './auth-deep-link';

// Web confirmation lands on the Site URL; supabase-js consumes the fragment when
// `detectSessionInUrl` is true. Custom-scheme Linking is a native concern.
export const registerAuthDeepLink: RegisterAuthDeepLink = () => () => {};
