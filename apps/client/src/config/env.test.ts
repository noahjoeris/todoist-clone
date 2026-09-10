import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSupabaseEnv } from './env';

const URL_VAR = 'EXPO_PUBLIC_SUPABASE_URL';
const KEY_VAR = 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY';

describe('loadSupabaseEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is unconfigured when neither variable is set', () => {
    vi.stubEnv(URL_VAR, undefined);
    vi.stubEnv(KEY_VAR, undefined);
    expect(loadSupabaseEnv()).toEqual({ status: 'unconfigured' });
  });

  it('treats empty values as unset', () => {
    vi.stubEnv(URL_VAR, '');
    vi.stubEnv(KEY_VAR, '   ');
    expect(loadSupabaseEnv()).toEqual({ status: 'unconfigured' });
  });

  it('returns the parsed configuration when both variables are valid', () => {
    vi.stubEnv(URL_VAR, 'https://example.supabase.co');
    vi.stubEnv(KEY_VAR, 'sb_publishable_test');
    expect(loadSupabaseEnv()).toEqual({
      status: 'configured',
      env: {
        supabaseUrl: 'https://example.supabase.co',
        supabasePublishableKey: 'sb_publishable_test',
      },
    });
  });

  it('reports a partial configuration by variable name', () => {
    vi.stubEnv(URL_VAR, 'https://example.supabase.co');
    vi.stubEnv(KEY_VAR, undefined);
    const result = loadSupabaseEnv();
    expect(result.status).toBe('invalid');
    if (result.status !== 'invalid') throw new Error('expected invalid');
    expect(result.error.message).toContain(KEY_VAR);
    expect(result.error.message).not.toContain(URL_VAR);
    expect(result.error.message).toContain('.env.example');
  });

  it('reports a malformed URL', () => {
    vi.stubEnv(URL_VAR, 'example.supabase.co');
    vi.stubEnv(KEY_VAR, 'sb_publishable_test');
    const result = loadSupabaseEnv();
    expect(result.status).toBe('invalid');
    if (result.status !== 'invalid') throw new Error('expected invalid');
    expect(result.error.message).toMatch(/EXPO_PUBLIC_SUPABASE_URL: must be the project URL/);
  });
});
