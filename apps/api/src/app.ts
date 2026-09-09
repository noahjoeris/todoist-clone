import cors from '@fastify/cors';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { type Env, parseCorsOrigin } from './config/env.js';
import { healthRoutes } from './routes/health.js';

export interface BuildAppOptions {
  env: Env;
  version: string;
  logger?: FastifyServerOptions['logger'];
}

/**
 * Builds the Fastify instance without starting it. Kept separate from
 * `server.ts` so tests can call `app.inject()` without opening a socket.
 */
export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? { level: options.env.LOG_LEVEL },
    // Pass the client's request id through when provided.
    requestIdHeader: 'x-request-id',
  });

  await app.register(cors, { origin: parseCorsOrigin(options.env.CORS_ORIGIN) });

  await app.register(healthRoutes, { version: options.version });

  return app;
}
