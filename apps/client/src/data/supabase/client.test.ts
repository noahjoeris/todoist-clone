import { describe, expect, it, vi } from 'vitest';
import { EMAIL_CONFIRMATION_REDIRECT_TO } from './auth-callback';
import { createSupabaseAuthConfig } from './client';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));

describe('createSupabaseAuthConfig', () => {
  it('enables PKCE from native platform options and leaves web implicit', async () => {
    const { authPlatformOptions: nativeOptions } = await import('./auth-platform.native');
    const { authPlatformOptions: webOptions } = await import('./auth-platform.web');

    expect(nativeOptions.flowType).toBe('pkce');
    expect(nativeOptions.detectSessionInUrl).toBe(false);
    expect(nativeOptions.emailRedirectTo).toBe(EMAIL_CONFIRMATION_REDIRECT_TO);
    expect(createSupabaseAuthConfig(nativeOptions)).toEqual({
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
      storage: nativeOptions.storage,
    });

    expect(webOptions).not.toHaveProperty('flowType');
    expect(webOptions.detectSessionInUrl).toBe(true);
    expect(createSupabaseAuthConfig(webOptions)).toEqual({
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    });
  });
});
