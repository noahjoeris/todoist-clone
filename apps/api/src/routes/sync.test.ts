import type { DatabaseConnection } from '@todoist-clone/database';
import type { FastifyInstance } from 'fastify';
import {
  type CryptoKey,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWTVerifyGetKey,
  SignJWT,
} from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { InvalidRequestError } from '../sync/apply-upload.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const testEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/postgres',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SECRET_KEY: 'sb_secret_test',
} as const;

describe('POST /sync/upload', () => {
  let app: FastifyInstance;
  let getKey: JWTVerifyGetKey;
  let privateKey: CryptoKey;

  beforeAll(async () => {
    const key = await generateKeyPair('ES256', { extractable: true });
    privateKey = key.privateKey;
    const jwk = await exportJWK(key.publicKey);
    jwk.kid = 'key-1';
    getKey = createLocalJWKSet({ keys: [jwk] });

    const database = {
      db: {
        transaction: async () => {
          throw new Error('database.transaction should not be reached');
        },
      },
      close: async () => {},
    } as unknown as DatabaseConnection;

    app = await buildApp({
      env: loadEnv(testEnv),
      version: '0.0.0',
      logger: false,
      getKey,
      database,
    });
    await app.ready();
  });

  afterAll(() => app.close());

  async function bearer(): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: 'key-1' })
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('5m')
      .setSubject(USER_ID)
      .sign(privateKey);
  }

  it('returns 401 without a token', async () => {
    const response = await app.inject({ method: 'POST', url: '/sync/upload', payload: {} });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'unauthorized' });
  });

  it('returns 400 for a body with no operations', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/sync/upload',
      headers: { authorization: `Bearer ${await bearer()}` },
      payload: { operations: [] },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('invalid-request');
    expect(response.json().issues.length).toBeGreaterThan(0);
  });

  it('returns 400 when merged date/time is invalid', async () => {
    const database = {
      db: {
        transaction: async () => {
          throw new InvalidRequestError([
            { path: 'scheduled_time', message: 'scheduled_time requires scheduled_date' },
          ]);
        },
      },
      close: async () => {},
    } as unknown as DatabaseConnection;

    const invalidApp = await buildApp({
      env: loadEnv(testEnv),
      version: '0.0.0',
      logger: false,
      getKey,
      database,
    });
    await invalidApp.ready();

    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: 'key-1' })
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('5m')
      .setSubject(USER_ID)
      .sign(privateKey);

    const response = await invalidApp.inject({
      method: 'POST',
      url: '/sync/upload',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        operations: [
          {
            clientId: 2,
            op: 'PATCH',
            table: 'tasks',
            id: TASK_ID,
            opData: { title: 'Keep' },
          },
        ],
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'invalid-request',
      issues: [{ path: 'scheduled_time', message: 'scheduled_time requires scheduled_date' }],
    });
    await invalidApp.close();
  });

  it('returns 400 for an unknown table', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/sync/upload',
      headers: { authorization: `Bearer ${await bearer()}` },
      payload: {
        operations: [
          {
            clientId: 1,
            op: 'PUT',
            table: 'projects',
            id: TASK_ID,
            opData: {
              title: 'Nope',
              description: '',
              priority: 4,
              created_at: '2026-09-11T12:00:00.000Z',
            },
          },
        ],
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('invalid-request');
  });
});
