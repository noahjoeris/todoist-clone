import type { CommonPowerSyncDatabase } from '@powersync/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadPublicEnv, type PublicEnv } from '../config/env';
import { createPowerSyncDatabase } from './powersync/create-database';
import { createSupabaseClient } from './supabase/client';

/**
 * Composition root for client-side data access. Instantiate once per app and
 * hand repositories the `powersync` instance; UI code should not import this directly.
 *
 * `powersync.connect(...)` is intentionally not called yet: the backend connector
 * (auth token + upload queue handler) arrives together with the first synced table.
 */
export interface DataSystem {
  env: PublicEnv;
  supabase: SupabaseClient;
  powersync: CommonPowerSyncDatabase;
}

export function createDataSystem(): DataSystem {
  const env = loadPublicEnv();
  return {
    env,
    supabase: createSupabaseClient(env),
    powersync: createPowerSyncDatabase(),
  };
}
