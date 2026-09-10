import { z } from 'zod';

const scheduledTimeSchema = z.union([z.iso.time({ precision: -1 }), z.iso.time({ precision: 0 })]);

function timeRequiresDate(task: {
  scheduled_date?: string | null | undefined;
  scheduled_time?: string | null | undefined;
}): boolean {
  return task.scheduled_time == null || task.scheduled_date != null;
}

/**
 * PowerSync SQLite / upload-wire columns for `tasks`.
 * `id`, `user_id` and `updated_at` are stripped if present — the server owns them.
 */
export const taskColumnsSchema = z
  .object({
    title: z.string().trim().min(1),
    description: z.string().trim().default(''),
    priority: z.number().int().min(1).max(4),
    scheduled_date: z.iso.date().nullable().optional(),
    scheduled_time: scheduledTimeSchema.nullable().optional(),
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
    created_at: z.iso.datetime({ offset: true }).optional(),
  })
  .strip()
  .refine(timeRequiresDate, {
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
