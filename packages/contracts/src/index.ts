/**
 * Shared contracts between the API and the client.
 *
 * Rules:
 * - Only Zod schemas and types derived from them live here.
 * - No database models, no runtime dependencies on server or client code.
 */
export { type HealthResponse, healthResponseSchema } from './health.js';
export { type MeResponse, meResponseSchema } from './me.js';
