import { meResponseSchema } from '@todoist-clone/contracts';
import type { FastifyPluginAsync } from 'fastify';

export const meRoutes: FastifyPluginAsync = async (app) => {
  app.get('/me', { onRequest: app.authenticate }, async (request, reply) => {
    const user = request.user;
    if (!user) {
      return reply.header('WWW-Authenticate', 'Bearer').code(401).send({ error: 'unauthorized' });
    }
    return meResponseSchema.parse({ id: user.id });
  });
};
