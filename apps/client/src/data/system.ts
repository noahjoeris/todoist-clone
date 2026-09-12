import type { CommonPowerSyncDatabase } from '@powersync/common';
import { randomUUID } from 'expo-crypto';
import { loadCloudEnv } from '../config/env';
import { createPowerSyncDatabase } from './powersync/create-database';
import {
  type AuthRepository,
  createAuthRepository,
  createGuestTaskAdoptionRepository,
  createLabelRepositories,
  createProjectRepositories,
  createRecentSearchRepositories,
  createTaskRepositories,
  type GuestTaskAdoptionRepository,
  type LabelRepositories,
  type ProjectRepositories,
  type RecentSearchRepositories,
  type SyncStatusSource,
  type TaskRepositories,
} from './repositories';
import { parseAuthUrlError, parseAuthUrlType } from './repositories/auth-url';
import { registerAuthDeepLink } from './supabase/auth-deep-link';
import { registerAuthLifecycle } from './supabase/auth-lifecycle';
import { authPlatformOptions } from './supabase/auth-platform';
import { createSupabaseClient } from './supabase/client';
import { createBackendConnector } from './sync/backend-connector';
import {
  createLocalDataReadiness,
  createSyncStatusSource,
  startSyncLifecycle,
} from './sync/sync-lifecycle';
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
  labels: LabelRepositories;
  projects: ProjectRepositories;
  guestTaskAdoption: GuestTaskAdoptionRepository;
  searchRecents: RecentSearchRepositories;
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
  const labels = createLabelRepositories(powersync, randomUUID);
  const projects = createProjectRepositories(powersync, randomUUID);
  const guestTaskAdoption = createGuestTaskAdoptionRepository(powersync);
  const searchRecents = createRecentSearchRepositories(powersync);
  const cloud = createCloudServices(powersync, guestTaskAdoption);
  return {
    powersync,
    tasks,
    labels,
    projects,
    guestTaskAdoption,
    searchRecents,
    auth: cloud.auth,
    ...(cloud.sync ? { sync: cloud.sync } : {}),
    dispose: cloud.dispose,
  };
}

function createCloudServices(
  powersync: CommonPowerSyncDatabase,
  guestTaskAdoption: GuestTaskAdoptionRepository,
): {
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
      // Parse before createClient: supabase-js may strip a successful session from the URL.
      // Error params are left in place, but reading first keeps this reusable for both.
      const href = authPlatformOptions.getLocationHref?.();
      const urlAuthError = href ? parseAuthUrlError(href) : null;
      const passwordRecoveryFromUrl = href ? parseAuthUrlType(href) === 'recovery' : false;
      const supabase = createSupabaseClient(cloudEnv.env);
      const { emailRedirectTo } = authPlatformOptions;
      const repository = createAuthRepository(supabase.auth, registerAuthLifecycle, {
        registerDeepLink: registerAuthDeepLink,
        ...(emailRedirectTo !== undefined ? { emailRedirectTo } : {}),
        ...(urlAuthError ? { urlAuthError } : {}),
        ...(passwordRecoveryFromUrl ? { passwordRecoveryFromUrl } : {}),
      });
      const localData = createLocalDataReadiness();
      const stopSync = startSyncLifecycle(
        powersync,
        repository,
        (userId) =>
          createBackendConnector({
            auth: supabase.auth,
            powersyncUrl: cloudEnv.env.powersyncUrl,
            apiUrl: cloudEnv.env.apiUrl,
            expectedUserId: userId,
          }),
        createSyncOwnerStore(),
        localData,
      );
      let adoptionSkipUserId: string | undefined;
      const stopAdoptionReset = repository.subscribe((state) => {
        if (state.status === 'signed-out') {
          adoptionSkipUserId = undefined;
          guestTaskAdoption.reset();
          return;
        }
        if (state.status !== 'signed-in') return;
        if (adoptionSkipUserId !== undefined && adoptionSkipUserId !== state.user.id) {
          guestTaskAdoption.reset();
        }
        adoptionSkipUserId = state.user.id;
      });
      return {
        auth: { status: 'available', repository },
        sync: createSyncStatusSource(powersync, localData),
        dispose() {
          stopAdoptionReset();
          stopSync();
          repository.dispose();
        },
      };
    }
  }
}
