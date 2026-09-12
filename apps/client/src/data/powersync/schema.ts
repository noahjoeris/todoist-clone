import { column, Schema, Table } from '@powersync/common';

/**
 * Client-side SQLite schema managed by PowerSync.
 *
 * Synced tables must mirror Postgres and Sync Streams. Local-only tables are
 * device-owned and need neither. PowerSync adds the text `id` column itself.
 */
// Guest tasks stay on this device and never enter the upload queue. Adoption
// copies them into `tasks` (ADR-016); this table is not converted in place.
const localTasks = new Table(
  {
    title: column.text,
    description: column.text,
    priority: column.integer,
    scheduled_date: column.text,
    scheduled_time: column.text,
    completed_at: column.text,
    created_at: column.text,
  },
  { localOnly: true },
);

// Device-level flags such as "don't ask again" for guest-task adoption (ADR-016).
// Survives disconnectAndClear({ clearLocal: false }). Key is the PowerSync `id`.
const localPreferences = new Table({ value: column.text }, { localOnly: true });

// Account-owned rows. Mirrors public.tasks and the user_tasks Sync Stream.
const tasks = new Table({
  user_id: column.text,
  title: column.text,
  description: column.text,
  priority: column.integer,
  scheduled_date: column.text,
  scheduled_time: column.text,
  completed_at: column.text,
  created_at: column.text,
  updated_at: column.text,
});

// Account-owned labels. Mirrors public.labels and the user_labels Sync Stream.
// SQLite stores boolean `is_favorite` as integer (PowerSync convention).
const labels = new Table({
  user_id: column.text,
  name: column.text,
  color: column.text,
  is_favorite: column.integer,
  created_at: column.text,
  updated_at: column.text,
});

// Account-owned task↔label links. Mirrors public.task_labels / user_task_labels.
const taskLabels = new Table({
  user_id: column.text,
  task_id: column.text,
  label_id: column.text,
  created_at: column.text,
});

export const appSchema = new Schema({
  local_tasks: localTasks,
  local_preferences: localPreferences,
  tasks,
  labels,
  task_labels: taskLabels,
});

export type AppDatabaseTypes = (typeof appSchema)['types'];
