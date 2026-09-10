import { PowerSyncDatabase } from '@powersync/web';
import { type CreatePowerSyncDatabase, POWERSYNC_DB_FILENAME } from './database-options';
import { appSchema } from './schema';

// Web workers are copied into `public/@powersync` by `pnpm powersync:copy-assets`
// (run automatically by the `web` and `export:web` scripts) and served from the site root.
const POWERSYNC_WORKER_PATH = '/@powersync/worker.js';

export const createPowerSyncDatabase: CreatePowerSyncDatabase = () =>
  new PowerSyncDatabase({
    schema: appSchema,
    database: {
      dbFilename: POWERSYNC_DB_FILENAME,
      worker: POWERSYNC_WORKER_PATH,
    },
    sync: {
      worker: POWERSYNC_WORKER_PATH,
    },
  });
