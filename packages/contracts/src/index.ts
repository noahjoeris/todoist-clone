/**
 * Shared contracts between the API and the client.
 *
 * Rules:
 * - Only Zod schemas and types derived from them live here.
 * - No database models, no runtime dependencies on server or client code.
 */
export { type HealthResponse, healthResponseSchema } from './health.js';
export { type MeResponse, meResponseSchema } from './me.js';
export {
  type CrudEntry,
  crudEntrySchema,
  LABEL_COLORS,
  type LabelColor,
  type LabelColumns,
  type LabelPatchColumns,
  labelColorSchema,
  labelColumnsSchema,
  labelPatchColumnsSchema,
  mergeScheduledColumns,
  normalizeSqliteBoolean,
  type ScheduledColumns,
  type TaskColumns,
  type TaskLabelColumns,
  type TaskPatchColumns,
  taskColumnsSchema,
  taskLabelColumnsSchema,
  taskPatchColumnsSchema,
  type UploadError,
  type UploadRequest,
  type UploadResponse,
  uploadErrorSchema,
  uploadRequestSchema,
  uploadResponseSchema,
} from './sync.js';
