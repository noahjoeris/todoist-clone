import { z } from 'zod';

const scheduledTimeSchema = z.union([z.iso.time({ precision: -1 }), z.iso.time({ precision: 0 })]);

/**
 * PowerSync maps Postgres timestamptz to SQLite text as `YYYY-MM-DD hh:mm:ss.sssZ`
 * (space separator). RFC 3339 and `z.iso.datetime` require `T`.
 */
function normalizePowerSyncTimestamptz(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value.replace(/^(\d{4}-\d{2}-\d{2}) (\d)/, '$1T$2');
}

const wireDatetime = z.preprocess(normalizePowerSyncTimestamptz, z.iso.datetime({ offset: true }));

function timeRequiresDate(task: {
  scheduled_date?: string | null | undefined;
  scheduled_time?: string | null | undefined;
}): boolean {
  return task.scheduled_time == null || task.scheduled_date != null;
}

/** A missing PATCH date is "unchanged", not null; the server merges with the stored row. */
function patchTimeRequiresDate(task: {
  scheduled_date?: string | null | undefined;
  scheduled_time?: string | null | undefined;
}): boolean {
  return task.scheduled_time == null || task.scheduled_date !== null;
}

export type ScheduledColumns = {
  scheduled_date: string | null;
  scheduled_time: string | null;
};

/**
 * PowerSync SQLite / upload-wire columns for `tasks`.
 * `id`, `user_id` and `updated_at` are stripped if present — the server owns them.
 *
 * `completed_at` is a client-owned timestamp. PUT omission or null means active
 * (PowerSync omits nulls). PATCH omission means unchanged; explicit null reopens.
 * `project_id` is nullable membership: PUT omission or null means Inbox; PATCH
 * omission leaves membership unchanged; explicit null moves to Inbox.
 * `created_at` / `completed_at` accept PowerSync's space-separated timestamptz.
 */
export const taskColumnsSchema = z
  .object({
    title: z.string().trim().min(1),
    description: z.string().trim().default(''),
    priority: z.number().int().min(1).max(4),
    scheduled_date: z.iso.date().nullable().optional(),
    scheduled_time: scheduledTimeSchema.nullable().optional(),
    completed_at: wireDatetime.nullable().optional(),
    created_at: wireDatetime,
    project_id: z.uuid().nullable().optional(),
  })
  .strip()
  .refine(timeRequiresDate, {
    path: ['scheduled_time'],
    message: 'scheduled_time requires scheduled_date',
  });

export const taskPatchColumnsSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    description: z.string().trim().optional(),
    priority: z.number().int().min(1).max(4).optional(),
    scheduled_date: z.iso.date().nullable().optional(),
    scheduled_time: scheduledTimeSchema.nullable().optional(),
    completed_at: wireDatetime.nullable().optional(),
    created_at: wireDatetime.optional(),
    project_id: z.uuid().nullable().optional(),
  })
  .strip()
  .refine(patchTimeRequiresDate, {
    path: ['scheduled_time'],
    message: 'scheduled_time requires scheduled_date',
  });

/** Todoist 20-color palette. Default on create is `charcoal`. */
export const LABEL_COLORS = [
  'berry_red',
  'red',
  'orange',
  'yellow',
  'olive_green',
  'lime_green',
  'green',
  'mint_green',
  'teal',
  'sky_blue',
  'light_blue',
  'blue',
  'grape',
  'violet',
  'lavender',
  'magenta',
  'salmon',
  'charcoal',
  'grey',
  'taupe',
] as const;

export const labelColorSchema = z.enum(LABEL_COLORS);

/**
 * PowerSync SQLite stores booleans as integer 0/1. Convert those explicitly;
 * do not coerce other truthy/falsy values.
 */
export function normalizeSqliteBoolean(value: unknown): unknown {
  if (value === 0) return false;
  if (value === 1) return true;
  return value;
}

const wireBoolean = z.preprocess(normalizeSqliteBoolean, z.boolean());

/**
 * PowerSync SQLite / upload-wire columns for `labels`.
 * `id`, `user_id` and `updated_at` are stripped if present — the server owns them.
 */
export const labelColumnsSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    color: labelColorSchema.default('charcoal'),
    is_favorite: wireBoolean.default(false),
    created_at: wireDatetime,
  })
  .strip();

export const labelPatchColumnsSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    color: labelColorSchema.optional(),
    is_favorite: wireBoolean.optional(),
    created_at: wireDatetime.optional(),
  })
  .strip();

const sortOrderSchema = z.number().int().min(0).max(2147483647);

/**
 * PowerSync SQLite / upload-wire columns for `projects`.
 * `id`, `user_id` and `updated_at` are stripped if present — the server owns them.
 */
export const projectColumnsSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    color: labelColorSchema.default('charcoal'),
    is_favorite: wireBoolean.default(false),
    is_archived: wireBoolean.default(false),
    sort_order: sortOrderSchema.default(0),
    created_at: wireDatetime,
  })
  .strip();

export const projectPatchColumnsSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    color: labelColorSchema.optional(),
    is_favorite: wireBoolean.optional(),
    is_archived: wireBoolean.optional(),
    sort_order: sortOrderSchema.optional(),
    created_at: wireDatetime.optional(),
  })
  .strip();

/**
 * PowerSync SQLite / upload-wire columns for `task_labels`.
 * Links support PUT/DELETE only. `id` and `user_id` are stripped if present.
 */
export const taskLabelColumnsSchema = z
  .object({
    task_id: z.uuid(),
    label_id: z.uuid(),
    created_at: wireDatetime,
  })
  .strip();

const crudEntryBase = {
  clientId: z.number().int(),
  id: z.uuid(),
};

const taskCrudEntrySchema = z.discriminatedUnion('op', [
  z.object({
    ...crudEntryBase,
    table: z.literal('tasks'),
    op: z.literal('PUT'),
    opData: taskColumnsSchema,
  }),
  z.object({
    ...crudEntryBase,
    table: z.literal('tasks'),
    op: z.literal('PATCH'),
    opData: taskPatchColumnsSchema,
  }),
  z.object({
    ...crudEntryBase,
    table: z.literal('tasks'),
    op: z.literal('DELETE'),
    opData: z.unknown().nullable().optional(),
  }),
]);

const labelCrudEntrySchema = z.discriminatedUnion('op', [
  z.object({
    ...crudEntryBase,
    table: z.literal('labels'),
    op: z.literal('PUT'),
    opData: labelColumnsSchema,
  }),
  z.object({
    ...crudEntryBase,
    table: z.literal('labels'),
    op: z.literal('PATCH'),
    opData: labelPatchColumnsSchema,
  }),
  z.object({
    ...crudEntryBase,
    table: z.literal('labels'),
    op: z.literal('DELETE'),
    opData: z.unknown().nullable().optional(),
  }),
]);

const taskLabelCrudEntrySchema = z.discriminatedUnion('op', [
  z.object({
    ...crudEntryBase,
    table: z.literal('task_labels'),
    op: z.literal('PUT'),
    opData: taskLabelColumnsSchema,
  }),
  z.object({
    ...crudEntryBase,
    table: z.literal('task_labels'),
    op: z.literal('DELETE'),
    opData: z.unknown().nullable().optional(),
  }),
]);

const projectCrudEntrySchema = z.discriminatedUnion('op', [
  z.object({
    ...crudEntryBase,
    table: z.literal('projects'),
    op: z.literal('PUT'),
    opData: projectColumnsSchema,
  }),
  z.object({
    ...crudEntryBase,
    table: z.literal('projects'),
    op: z.literal('PATCH'),
    opData: projectPatchColumnsSchema,
  }),
  z.object({
    ...crudEntryBase,
    table: z.literal('projects'),
    op: z.literal('DELETE'),
    opData: z.unknown().nullable().optional(),
  }),
]);

export const crudEntrySchema = z.union([
  taskCrudEntrySchema,
  labelCrudEntrySchema,
  taskLabelCrudEntrySchema,
  projectCrudEntrySchema,
]);

export const uploadRequestSchema = z.object({
  transactionId: z.number().int().optional(),
  operations: z.array(crudEntrySchema).min(1).max(2000),
});

export const uploadResponseSchema = z.object({
  applied: z.number().int(),
});

export const uploadErrorSchema = z.object({
  error: z.enum(['invalid-request', 'forbidden', 'unauthorized']),
  issues: z
    .array(
      z.object({
        path: z.string(),
        message: z.string(),
      }),
    )
    .optional(),
});

export type TaskColumns = z.infer<typeof taskColumnsSchema>;
export type TaskPatchColumns = z.infer<typeof taskPatchColumnsSchema>;
export type LabelColor = (typeof LABEL_COLORS)[number];
export type LabelColumns = z.infer<typeof labelColumnsSchema>;
export type LabelPatchColumns = z.infer<typeof labelPatchColumnsSchema>;
export type ProjectColumns = z.infer<typeof projectColumnsSchema>;
export type ProjectPatchColumns = z.infer<typeof projectPatchColumnsSchema>;
export type TaskLabelColumns = z.infer<typeof taskLabelColumnsSchema>;
export type CrudEntry = z.infer<typeof crudEntrySchema>;
export type UploadRequest = z.infer<typeof uploadRequestSchema>;
export type UploadResponse = z.infer<typeof uploadResponseSchema>;
export type UploadError = z.infer<typeof uploadErrorSchema>;

/**
 * Merge a PATCH's date/time onto the persisted row and normalize the coupled pair.
 * Returns `ok: false` when the patch itself sets a time without a date.
 * Clearing the date while a stored time remains drops that stale time.
 */
export function mergeScheduledColumns(
  persisted: ScheduledColumns,
  patch: Pick<TaskPatchColumns, 'scheduled_date' | 'scheduled_time'>,
): ({ ok: true } & ScheduledColumns) | { ok: false } {
  const scheduled_date =
    patch.scheduled_date !== undefined ? patch.scheduled_date : persisted.scheduled_date;
  const scheduled_time =
    patch.scheduled_time !== undefined ? patch.scheduled_time : persisted.scheduled_time;

  if (scheduled_time == null || scheduled_date != null) {
    return { ok: true, scheduled_date, scheduled_time };
  }

  if (patch.scheduled_time != null) {
    return { ok: false };
  }

  return { ok: true, scheduled_date: null, scheduled_time: null };
}
