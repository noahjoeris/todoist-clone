import { column, Schema, Table } from '@powersync/common';

/**
 * Client-side SQLite schema managed by PowerSync.
 *
 * Synced tables must mirror Postgres and Sync Streams. Local-only tables are
 * device-owned and need neither. PowerSync adds the text `id` column itself.
 */
// Guest tasks stay on this device and never enter the upload queue. Account adoption
// will explicitly copy these into a synced table when authentication is introduced.
const localTasks = new Table(
  {
    title: column.text,
    description: column.text,
    priority: column.integer,
    scheduled_date: column.text,
    scheduled_time: column.text,
    created_at: column.text,
  },
  { localOnly: true },
);

export const appSchema = new Schema({ local_tasks: localTasks });

export type AppDatabaseTypes = (typeof appSchema)['types'];
