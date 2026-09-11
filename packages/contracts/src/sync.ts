import { z } from 'zod';

const scheduledTimeSchema = z.union([z.iso.time({ precision: -1 }), z.iso.time({ precision: 0 })]);

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
 */
export const taskColumnsSchema = z
  .object({
    title: z.string().trim().min(1),
    description: z.string().trim().default(''),
    priority: z.number().int().min(1).max(4),
    scheduled_date: z.iso.date().nullable().optional(),
    scheduled_time: scheduledTimeSchema.nullable().optional(),
    completed_at: z.iso.datetime({ offset: true }).nullable().optional(),
    created_at: z.iso.datetime({ offset: true }),
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
    completed_at: z.iso.datetime({ offset: true }).nullable().optional(),
    created_at: z.iso.datetime({ offset: true }).optional(),
  })
  .strip()
  .refine(patchTimeRequiresDate, {
    path: ['scheduled_time'],
    message: 'scheduled_time requires scheduled_date',
  });

const crudEntryBaseSchema = z.object({
  clientId: z.number().int(),
  table: z.literal('tasks'),
  id: z.uuid(),
});

export const crudEntrySchema = z.discriminatedUnion('op', [
  crudEntryBaseSchema.extend({
    op: z.literal('PUT'),
    opData: taskColumnsSchema,
  }),
  crudEntryBaseSchema.extend({
    op: z.literal('PATCH'),
    opData: taskPatchColumnsSchema,
  }),
  crudEntryBaseSchema.extend({
    op: z.literal('DELETE'),
    opData: z.unknown().nullable().optional(),
  }),
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
