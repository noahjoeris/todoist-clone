import { Schema } from '@powersync/common';

/**
 * Client-side SQLite schema managed by PowerSync.
 *
 * Mirror of the synced subset of the Postgres schema (packages/database) as exposed by the
 * Sync Streams in infra/powersync/sync-config.yaml. PowerSync adds the `id` column itself.
 * Column types are limited to `column.text`, `column.integer` and `column.real`.
 *
 * Example:
 *   const tasks = new Table({ title: column.text, completed_at: column.text, ... });
 *   export const appSchema = new Schema({ tasks });
 */
export const appSchema = new Schema({});

export type AppDatabaseTypes = (typeof appSchema)['types'];
