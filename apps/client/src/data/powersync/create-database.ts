import type { CommonPowerSyncDatabase } from '@powersync/common';

export const POWERSYNC_DB_FILENAME = 'todoist-clone.sqlite';

/**
 * Platform-agnostic signature for opening the local PowerSync database.
 *
 * Metro resolves `./create-database` to `create-database.native.ts` on iOS/Android and to
 * `create-database.web.ts` on web. This file exists so TypeScript has a single declaration
 * to type-check against; it must never be bundled.
 */
export type CreatePowerSyncDatabase = () => CommonPowerSyncDatabase;

export const createPowerSyncDatabase: CreatePowerSyncDatabase = () => {
  throw new Error(
    'createPowerSyncDatabase was resolved without a platform suffix; expected .native.ts or .web.ts',
  );
};
