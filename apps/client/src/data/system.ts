import type { CommonPowerSyncDatabase } from '@powersync/common';
import { randomUUID } from 'expo-crypto';
import { loadCloudEnv } from '../config/env';
import { createPowerSyncDatabase } from './powersync/create-database';
import {
  type AuthRepository,
  createAuthRepository,
  createTaskRepositories,
  type SyncStatusSource,
  type TaskRepositories,
} from './repositories';
import { registerAuthLifecycle } from './supabase/auth-lifecycle';
import { createSupabaseClient } from './supabase/client';
import { createBackendConnector } from './sync/backend-connector';
import { createSyncStatusSource, startSyncLifecycle } from './sync/sync-lifecycle';
import { createSyncOwnerStore } from './sync/sync-owner-store';

/**
 * Composition root for client-side data access. Instantiate once per app and
 * hand repositories the `powersync` instance; UI code should not import this directly.
 *
 * When cloud env is configured, a backend connector uploads to the Fastify API and
 * `startSyncLifecycle` connects PowerSync for signed-in users.
 */
export interface DataSystem {
  powersync: CommonPowerSyncDatabase;
  tasks: TaskRepositories;
  auth: AuthAvailability;
  sync?: SyncStatusSource;
  dispose(): void;
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
  const tasks = createTaskRepositories(powersync, randomUUID);
  const cloud = createCloudServices(powersync);
  return {
    powersync,
    tasks,
    auth: cloud.auth,
    ...(cloud.sync ? { sync: cloud.sync } : {}),
    dispose: cloud.dispose,
  };
}

function createCloudServices(powersync: CommonPowerSyncDatabase): {
  auth: AuthAvailability;
  sync?: SyncStatusSource;
  dispose(): void;
} {
  const cloudEnv = loadCloudEnv();
  switch (cloudEnv.status) {
    case 'unconfigured':
      return { auth: { status: 'unconfigured' }, dispose() {} };
    case 'invalid':
      return { auth: { status: 'misconfigured', error: cloudEnv.error }, dispose() {} };
    case 'configured': {
      const supabase = createSupabaseClient(cloudEnv.env);
      const repository = createAuthRepository(supabase.auth, registerAuthLifecycle);
      const connector = createBackendConnector({
        auth: supabase.auth,
        powersyncUrl: cloudEnv.env.powersyncUrl,
        apiUrl: cloudEnv.env.apiUrl,
      });
      const stopSync = startSyncLifecycle(powersync, repository, connector, createSyncOwnerStore());
      return {
        auth: { status: 'available', repository },
        sync: createSyncStatusSource(powersync),
        dispose() {
          stopSync();
          repository.dispose();
        },
      };
    }
  }
}
