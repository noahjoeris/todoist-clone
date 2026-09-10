import type { SupportedStorage } from '@supabase/supabase-js';

// supabase-js defaults to `window.localStorage` when no storage is supplied.
export const authStorage: SupportedStorage | undefined = undefined;
