import { uploadRequestSchema, uploadResponseSchema } from '@todoist-clone/contracts';
import type { FastifyPluginAsync } from 'fastify';
import { applyUpload, ForbiddenError, InvalidRequestError } from '../sync/apply-upload.js';

/**
 * PowerSync backend connector contract (ADR-014):
 * - 2xx / 4xx → connector `complete()`s the transaction (4xx is a client bug;
 *   the batch is discarded).
 * - 5xx / network → retry.
 * - 403 on one op rolls back the whole batch, including earlier PUTs in this request.
 */
export const syncRoutes: FastifyPluginAsync = async (app) => {
  app.post('/sync/upload', { onRequest: app.authenticate }, async (request, reply) => {
    const user = request.user;
    if (!user) {
      return reply.header('WWW-Authenticate', 'Bearer').code(401).send({ error: 'unauthorized' });
    }

    const parsed = uploadRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid-request',
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      });
    }

    try {
      await app.db.transaction((tx) => applyUpload(tx, user.id, parsed.data.operations));
    } catch (error) {
      if (error instanceof ForbiddenError) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      if (error instanceof InvalidRequestError) {
        return reply.code(400).send({ error: 'invalid-request', issues: error.issues });
      }
      throw error;
    }

    return uploadResponseSchema.parse({ applied: parsed.data.operations.length });
  });
};
