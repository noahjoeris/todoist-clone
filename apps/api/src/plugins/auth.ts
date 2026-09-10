import type { FastifyReply, onRequestHookHandler } from 'fastify';
import fp from 'fastify-plugin';
import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from 'jose';

export interface AuthenticatedUser {
  id: string;
}

export interface AuthPluginOptions {
  jwksUrl: URL;
  getKey?: JWTVerifyGetKey;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthenticatedUser | null;
  }

  interface FastifyInstance {
    authenticate: onRequestHookHandler;
  }
}

export function supabaseJwksUrl(supabaseUrl: string): URL {
  return new URL(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`);
}

const unauthorizedBody = { error: 'unauthorized' } as const;

function sendUnauthorized(reply: FastifyReply) {
  return reply.header('WWW-Authenticate', 'Bearer').code(401).send(unauthorizedBody);
}

export const authPlugin = fp<AuthPluginOptions>(
  async (app, options) => {
    const getKey = options.getKey ?? createRemoteJWKSet(options.jwksUrl);

    app.decorateRequest('user', null);

    app.decorate<onRequestHookHandler>('authenticate', async function authenticate(request, reply) {
      const header = request.headers.authorization;
      if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
        return sendUnauthorized(reply);
      }

      const token = header.slice('Bearer '.length);
      if (token.length === 0) {
        return sendUnauthorized(reply);
      }

      try {
        const { payload } = await jwtVerify(token, getKey, {
          algorithms: ['ES256'],
          audience: 'authenticated',
        });
        if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
          return sendUnauthorized(reply);
        }
        request.user = { id: payload.sub };
      } catch (error) {
        request.log.debug({ err: error }, 'jwt verification failed');
        return sendUnauthorized(reply);
      }
    });
  },
  { name: 'auth' },
);
