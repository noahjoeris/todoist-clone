/**
 * Repository layer: the only place the UI is allowed to touch the local database.
 *
 * Each repository wraps a PowerSync database and exposes intention-revealing methods
 * (`listTasksForToday()`, `completeTask(id)`), hiding SQL and PowerSync APIs from components.
 * Business rules (validation, derived state) live here or in pure helpers next to the
 * repository so they can be unit-tested without a database.
 *
 * Add repositories as features arrive, e.g.:
 *   export { createTaskRepository, type TaskRepository } from './task-repository';
 */
export {};
