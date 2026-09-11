import cors from '@fastify/cors';
import type { DatabaseConnection } from '@todoist-clone/database';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { JWTVerifyGetKey } from 'jose';
import { type Env, parseCorsOrigin } from './config/env.js';
import { authPlugin, supabaseJwksUrl } from './plugins/auth.js';
import { databasePlugin } from './plugins/database.js';
import { healthRoutes } from './routes/health.js';
import { meRoutes } from './routes/me.js';
import { syncRoutes } from './routes/sync.js';

export interface BuildAppOptions {
  env: Env;
  version: string;
  logger?: FastifyServerOptions['logger'];
  database?: DatabaseConnection;
  getKey?: JWTVerifyGetKey;
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

  const databaseOptions = options.database
    ? { url: options.env.DATABASE_URL, connection: options.database }
    : { url: options.env.DATABASE_URL };
  await app.register(databasePlugin, databaseOptions);

  const authOptions = options.getKey
    ? { jwksUrl: supabaseJwksUrl(options.env.SUPABASE_URL), getKey: options.getKey }
    : { jwksUrl: supabaseJwksUrl(options.env.SUPABASE_URL) };
  await app.register(authPlugin, authOptions);

  await app.register(healthRoutes, { version: options.version });
  await app.register(meRoutes);
  await app.register(syncRoutes);

  return app;
}
