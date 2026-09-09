import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';

describe('app', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({
      env: loadEnv({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/postgres',
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SECRET_KEY: 'sb_secret_test',
      }),
      version: '1.2.3',
      logger: false,
    });
    await app.ready();
  });

  afterAll(() => app.close());

  it('responds to GET /health', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', version: '1.2.3' });
  });
});
