/**
 * Application tables live here, one file per aggregate (e.g. `projects.ts`, `tasks.ts`).
 *
 * Conventions (see docs/architecture.md):
 * - Primary keys are `uuid` (PowerSync requires a single text `id` column on the client).
 * - Every synced table carries an owner/user column so both RLS and Sync Streams can filter on it.
 * - Tables must be added to the `powersync` publication explicitly (see infra/powersync).
 */

export * from './labels.js';
export * from './task-labels.js';
export * from './tasks.js';
