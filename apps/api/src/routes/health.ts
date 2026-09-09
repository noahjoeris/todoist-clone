import { type HealthResponse, healthResponseSchema } from '@todoist-clone/contracts';
import type { FastifyPluginAsync } from 'fastify';

export interface HealthRoutesOptions {
  version: string;
}

export const healthRoutes: FastifyPluginAsync<HealthRoutesOptions> = async (app, options) => {
  app.get('/health', async (): Promise<HealthResponse> => {
    return healthResponseSchema.parse({ status: 'ok', version: options.version });
  });
};
