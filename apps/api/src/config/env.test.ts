import { describe, expect, it } from 'vitest';
import { loadEnv, parseCorsOrigin } from './env.js';

const validEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/postgres',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SECRET_KEY: 'sb_secret_test',
};

describe('loadEnv', () => {
  it('applies defaults', () => {
    const env = loadEnv(validEnv);
    expect(env.PORT).toBe(3000);
    expect(env.HOST).toBe('0.0.0.0');
    expect(env.NODE_ENV).toBe('development');
  });

  it('coerces PORT to a number', () => {
    expect(loadEnv({ ...validEnv, PORT: '8080' }).PORT).toBe(8080);
  });

  it('lists every invalid variable', () => {
    expect(() => loadEnv({ SUPABASE_URL: 'not-a-url' })).toThrow(/DATABASE_URL[\s\S]*SUPABASE_URL/);
  });
});

describe('parseCorsOrigin', () => {
  it('passes the wildcard through', () => {
    expect(parseCorsOrigin('*')).toBe('*');
  });

  it('splits and trims a comma-separated list', () => {
    expect(parseCorsOrigin('http://localhost:8081, https://app.example.com')).toEqual([
      'http://localhost:8081',
      'https://app.example.com',
    ]);
  });
});
