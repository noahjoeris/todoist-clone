import type { CommonPowerSyncDatabase } from '@powersync/common';
import { randomUUID } from 'expo-crypto';
import { createPowerSyncDatabase } from './powersync/create-database';
import { createTaskRepository, type TaskRepository } from './repositories';

/**
 * Composition root for client-side data access. Instantiate once per app and
 * hand repositories the `powersync` instance; UI code should not import this directly.
 *
 * `powersync.connect(...)` is intentionally not called yet: the backend connector
 * (auth token + upload queue handler) arrives together with the first synced table.
 */
export interface DataSystem {
  powersync: CommonPowerSyncDatabase;
  tasks: TaskRepository;
}

export function createDataSystem(): DataSystem {
  const powersync = createPowerSyncDatabase();
  return {
    powersync,
    tasks: createTaskRepository(powersync, randomUUID),
  };
}
