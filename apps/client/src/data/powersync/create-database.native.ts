import '@azure/core-asynciterator-polyfill';

import { PowerSyncDatabase } from '@powersync/react-native';
import { type CreatePowerSyncDatabase, POWERSYNC_DB_FILENAME } from './database-options';
import { appSchema } from './schema';

// Requires an Expo development build: op-sqlite is a native module and does not run in Expo Go.
export const createPowerSyncDatabase: CreatePowerSyncDatabase = () =>
  new PowerSyncDatabase({
    schema: appSchema,
    database: { dbFilename: POWERSYNC_DB_FILENAME },
  });
