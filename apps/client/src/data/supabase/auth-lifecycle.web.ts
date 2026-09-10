import type { RegisterAuthLifecycle } from './auth-lifecycle';

// In browsers supabase-js manages auto-refresh from `visibilitychange` itself.
export const registerAuthLifecycle: RegisterAuthLifecycle = () => () => {};
