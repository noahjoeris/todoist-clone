import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadCloudEnv } from './env';

const URL_VAR = 'EXPO_PUBLIC_SUPABASE_URL';
const KEY_VAR = 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY';
const POWERSYNC_VAR = 'EXPO_PUBLIC_POWERSYNC_URL';
const API_VAR = 'EXPO_PUBLIC_API_URL';

const configured = {
  supabaseUrl: 'https://example.supabase.co',
  supabasePublishableKey: 'sb_publishable_test',
  powersyncUrl: 'https://example.powersync.journeyapps.com',
  apiUrl: 'http://localhost:3000',
} as const;

function stubConfigured() {
  vi.stubEnv(URL_VAR, configured.supabaseUrl);
  vi.stubEnv(KEY_VAR, configured.supabasePublishableKey);
  vi.stubEnv(POWERSYNC_VAR, configured.powersyncUrl);
  vi.stubEnv(API_VAR, configured.apiUrl);
}

function stubUnset() {
  vi.stubEnv(URL_VAR, undefined);
  vi.stubEnv(KEY_VAR, undefined);
  vi.stubEnv(POWERSYNC_VAR, undefined);
  vi.stubEnv(API_VAR, undefined);
}

describe('loadCloudEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is unconfigured when none of the four variables is set', () => {
    stubUnset();
    expect(loadCloudEnv()).toEqual({ status: 'unconfigured' });
  });

  it('treats empty values as unset', () => {
    vi.stubEnv(URL_VAR, '');
    vi.stubEnv(KEY_VAR, '   ');
    vi.stubEnv(POWERSYNC_VAR, '');
    vi.stubEnv(API_VAR, '  ');
    expect(loadCloudEnv()).toEqual({ status: 'unconfigured' });
  });

  it('returns the parsed configuration when all four variables are valid', () => {
    stubConfigured();
    expect(loadCloudEnv()).toEqual({
      status: 'configured',
      env: configured,
    });
  });

  it('reports a partial configuration by variable name', () => {
    vi.stubEnv(URL_VAR, configured.supabaseUrl);
    vi.stubEnv(KEY_VAR, configured.supabasePublishableKey);
    vi.stubEnv(POWERSYNC_VAR, undefined);
    vi.stubEnv(API_VAR, undefined);
    const result = loadCloudEnv();
    expect(result.status).toBe('invalid');
    if (result.status !== 'invalid') throw new Error('expected invalid');
    expect(result.error.message).toContain(POWERSYNC_VAR);
    expect(result.error.message).toContain(API_VAR);
    expect(result.error.message).not.toContain(`${URL_VAR}:`);
    expect(result.error.message).toContain('.env.example');
  });

  it('reports a malformed URL', () => {
    stubConfigured();
    vi.stubEnv(URL_VAR, 'example.supabase.co');
    const result = loadCloudEnv();
    expect(result.status).toBe('invalid');
    if (result.status !== 'invalid') throw new Error('expected invalid');
    expect(result.error.message).toMatch(/EXPO_PUBLIC_SUPABASE_URL: must be the project URL/);
  });

  it('strips trailing slashes from the API origin', () => {
    stubConfigured();
    vi.stubEnv(API_VAR, 'http://localhost:3000/');
    expect(loadCloudEnv()).toEqual({
      status: 'configured',
      env: configured,
    });
  });
});
