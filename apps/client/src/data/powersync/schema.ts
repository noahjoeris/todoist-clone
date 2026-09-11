import { column, Schema, Table } from '@powersync/common';

/**
 * Client-side SQLite schema managed by PowerSync.
 *
 * Synced tables must mirror Postgres and Sync Streams. Local-only tables are
 * device-owned and need neither. PowerSync adds the text `id` column itself.
 */
// Guest tasks stay on this device and never enter the upload queue. Adoption
// copies them into `tasks` later (ADR-011); this table is not converted in place.
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

// Account-owned rows. Mirrors public.tasks and the user_tasks Sync Stream.
const tasks = new Table({
  user_id: column.text,
  title: column.text,
  description: column.text,
  priority: column.integer,
  scheduled_date: column.text,
  scheduled_time: column.text,
  created_at: column.text,
  updated_at: column.text,
});

export const appSchema = new Schema({ local_tasks: localTasks, tasks });

export type AppDatabaseTypes = (typeof appSchema)['types'];
