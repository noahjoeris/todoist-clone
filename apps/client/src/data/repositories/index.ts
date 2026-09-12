/**
 * Repository layer: the only place the UI is allowed to touch the local database.
 *
 * Each repository wraps a PowerSync database and exposes intention-revealing methods
 * (`listTasksForToday()`, `completeTask(id)`), hiding SQL and PowerSync APIs from components.
 * Business rules (validation, derived state) live here or in pure helpers next to the
 * repository so they can be unit-tested without a database.
 *
 */

export {
  AuthFailure,
  type AuthFailureCode,
  type AuthState,
  type AuthUser,
  type Credentials,
  credentialsSchema,
  emailSchema,
  MIN_PASSWORD_LENGTH,
  passwordSchema,
} from './auth';
export {
  type AuthRepository,
  createAuthRepository,
  type SignUpOutcome,
} from './auth-repository';
export {
  createGuestTaskAdoptionRepository,
  type GuestTaskAdoptionRepository,
  type GuestTaskAdoptionState,
} from './guest-task-adoption';
export type { ClientSyncStatus, SyncStatusSource } from './sync';
export {
  type Task,
  type TaskInput,
  TaskNotFoundError,
  type TaskPriority,
  TaskRestoreConflictError,
  taskInputSchema,
} from './task';
export {
  createTaskRepositories,
  createTaskRepository,
  type TaskRepositories,
  type TaskRepository,
} from './task-repository';
