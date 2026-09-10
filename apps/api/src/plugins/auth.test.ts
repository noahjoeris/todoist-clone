import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
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
import { supabaseJwksUrl } from './auth.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';

const testEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/postgres',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SECRET_KEY: 'sb_secret_test',
} as const;

describe('supabaseJwksUrl', () => {
  it('appends the JWKS path and strips a trailing slash', () => {
    expect(supabaseJwksUrl('https://example.supabase.co').href).toBe(
      'https://example.supabase.co/auth/v1/.well-known/jwks.json',
    );
    expect(supabaseJwksUrl('https://example.supabase.co/').href).toBe(
      'https://example.supabase.co/auth/v1/.well-known/jwks.json',
    );
  });
});

describe('auth plugin', () => {
  let app: FastifyInstance;
  let getKey: JWTVerifyGetKey;
  let key1Private: CryptoKey;
  let key2Private: CryptoKey;

  beforeAll(async () => {
    const key1 = await generateKeyPair('ES256', { extractable: true });
    const key2 = await generateKeyPair('ES256', { extractable: true });
    key1Private = key1.privateKey;
    key2Private = key2.privateKey;

    const jwk1 = await exportJWK(key1.publicKey);
    jwk1.kid = 'key-1';
    getKey = createLocalJWKSet({ keys: [jwk1] });

    app = await buildApp({
      env: loadEnv(testEnv),
      version: '0.0.0',
      logger: false,
      getKey,
    });
    await app.ready();
  });

  afterAll(() => app.close());

  async function sign(options: {
    privateKey: CryptoKey;
    kid?: string;
    alg?: 'ES256' | 'HS256';
    audience?: string;
    subject?: string | null;
    issuedAt?: number;
    expiresIn?: string | number | Date;
    secret?: Uint8Array;
  }): Promise<string> {
    const jwt = new SignJWT({});
    jwt.setProtectedHeader({
      alg: options.alg ?? 'ES256',
      ...(options.kid === undefined ? {} : { kid: options.kid }),
    });
    jwt.setAudience(options.audience ?? 'authenticated');
    if (options.issuedAt === undefined) jwt.setIssuedAt();
    else jwt.setIssuedAt(options.issuedAt);
    jwt.setExpirationTime(options.expiresIn ?? '5m');
    if (options.subject !== null) {
      jwt.setSubject(options.subject ?? USER_ID);
    }
    if (options.alg === 'HS256') {
      if (!options.secret) throw new Error('HS256 requires a secret');
      return jwt.sign(options.secret);
    }
    return jwt.sign(options.privateKey);
  }

  function expectUnauthorized(response: LightMyRequestResponse) {
    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toBe('Bearer');
    expect(response.json()).toEqual({ error: 'unauthorized' });
  }

  it('returns the subject on GET /me with a valid ES256 token', async () => {
    const token = await sign({ privateKey: key1Private, kid: 'key-1' });
    const response = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: USER_ID });
  });

  it('rejects a missing Authorization header', async () => {
    expectUnauthorized(await app.inject({ method: 'GET', url: '/me' }));
  });

  it('rejects a Basic scheme', async () => {
    expectUnauthorized(
      await app.inject({
        method: 'GET',
        url: '/me',
        headers: { authorization: 'Basic dXNlcjpwYXNz' },
      }),
    );
  });

  it('rejects a garbage bearer token', async () => {
    expectUnauthorized(
      await app.inject({
        method: 'GET',
        url: '/me',
        headers: { authorization: 'Bearer not-a-jwt' },
      }),
    );
  });

  it('rejects an expired token', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await sign({
      privateKey: key1Private,
      kid: 'key-1',
      issuedAt: now - 120,
      expiresIn: now - 60,
    });
    expectUnauthorized(
      await app.inject({
        method: 'GET',
        url: '/me',
        headers: { authorization: `Bearer ${token}` },
      }),
    );
  });

  it('rejects an anonymous audience', async () => {
    const token = await sign({
      privateKey: key1Private,
      kid: 'key-1',
      audience: 'anon',
    });
    expectUnauthorized(
      await app.inject({
        method: 'GET',
        url: '/me',
        headers: { authorization: `Bearer ${token}` },
      }),
    );
  });

  it('rejects a token signed by an unknown kid', async () => {
    const token = await sign({ privateKey: key2Private, kid: 'key-2' });
    expectUnauthorized(
      await app.inject({
        method: 'GET',
        url: '/me',
        headers: { authorization: `Bearer ${token}` },
      }),
    );
  });

  it('rejects an HS256 token', async () => {
    const token = await sign({
      privateKey: key1Private,
      alg: 'HS256',
      secret: new TextEncoder().encode('test-hs256-secret-at-least-32-bytes!'),
    });
    expectUnauthorized(
      await app.inject({
        method: 'GET',
        url: '/me',
        headers: { authorization: `Bearer ${token}` },
      }),
    );
  });

  it('rejects a token with no sub', async () => {
    const token = await sign({ privateKey: key1Private, kid: 'key-1', subject: null });
    expectUnauthorized(
      await app.inject({
        method: 'GET',
        url: '/me',
        headers: { authorization: `Bearer ${token}` },
      }),
    );
  });
});
