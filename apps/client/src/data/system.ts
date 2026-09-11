import type { CommonPowerSyncDatabase } from '@powersync/common';
import { randomUUID } from 'expo-crypto';
import { loadSupabaseEnv } from '../config/env';
import { createPowerSyncDatabase } from './powersync/create-database';
import {
  type AuthRepository,
  createAuthRepository,
  createTaskRepository,
  type TaskRepository,
} from './repositories';
import { registerAuthLifecycle } from './supabase/auth-lifecycle';
import { createSupabaseClient } from './supabase/client';

/**
 * Composition root for client-side data access. Instantiate once per app and
 * hand repositories the `powersync` instance; UI code should not import this directly.
 *
 * `powersync.connect(...)` is intentionally not called yet: the backend connector
 * (auth token + upload queue handler) arrives in a later change. The `tasks` table
 * is already in the client schema so downloaded rows can materialize once connected.
 */
export interface DataSystem {
  powersync: CommonPowerSyncDatabase;
  tasks: TaskRepository;
  auth: AuthAvailability;
}

/**
 * Authentication is optional; guest tasks never depend on it.
 * `misconfigured` keeps guest mode working while telling the developer what to fix.
 */
export type AuthAvailability =
  | { status: 'unconfigured' }
  | { status: 'misconfigured'; error: Error }
  | { status: 'available'; repository: AuthRepository };

export function createDataSystem(): DataSystem {
  const powersync = createPowerSyncDatabase();
  return {
    powersync,
    tasks: createTaskRepository(powersync, randomUUID),
    auth: createAuthAvailability(),
  };
}

function createAuthAvailability(): AuthAvailability {
  const supabaseEnv = loadSupabaseEnv();
  switch (supabaseEnv.status) {
    case 'unconfigured':
      return { status: 'unconfigured' };
    case 'invalid':
      return { status: 'misconfigured', error: supabaseEnv.error };
    case 'configured': {
      const supabase = createSupabaseClient(supabaseEnv.env);
      return {
        status: 'available',
        repository: createAuthRepository(supabase.auth, registerAuthLifecycle),
      };
    }
  }
}
