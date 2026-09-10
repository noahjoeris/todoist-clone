import type { CommonPowerSyncDatabase } from '@powersync/common';

// Keep shared values outside create-database.ts: Metro resolves that name to the
// platform implementation, so importing it from an adapter creates a self-import.
export const POWERSYNC_DB_FILENAME = 'todoist-clone.sqlite';
export type CreatePowerSyncDatabase = () => CommonPowerSyncDatabase;
