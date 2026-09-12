import { AuthApiError } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import {
  createSessionFromAuthUrl,
  EMAIL_CONFIRMATION_REDIRECT_TO,
  parseAuthCallbackUrl,
} from './auth-callback';

describe('parseAuthCallbackUrl', () => {
  it('extracts a PKCE code from the callback query string', () => {
    expect(parseAuthCallbackUrl(`${EMAIL_CONFIRMATION_REDIRECT_TO}?code=pkce-code`)).toEqual({
      kind: 'code',
      code: 'pkce-code',
    });
  });

  it('extracts implicit tokens from the hash or the query string', () => {
    expect(
      parseAuthCallbackUrl(`${EMAIL_CONFIRMATION_REDIRECT_TO}#access_token=at&refresh_token=rt`),
    ).toEqual({ kind: 'tokens', accessToken: 'at', refreshToken: 'rt' });
    expect(
      parseAuthCallbackUrl(`${EMAIL_CONFIRMATION_REDIRECT_TO}?access_token=at&refresh_token=rt`),
    ).toEqual({ kind: 'tokens', accessToken: 'at', refreshToken: 'rt' });
  });

  it('prefers a PKCE code when both a code and tokens are present', () => {
    expect(
      parseAuthCallbackUrl(
        `${EMAIL_CONFIRMATION_REDIRECT_TO}?code=pkce-code#access_token=at&refresh_token=rt`,
      ),
    ).toEqual({ kind: 'code', code: 'pkce-code' });
  });

  it('accepts a trailing slash and an empty-host form of the callback path', () => {
    expect(parseAuthCallbackUrl('todoist-clone://auth/callback/?code=pkce-code')).toEqual({
      kind: 'code',
      code: 'pkce-code',
    });
    expect(parseAuthCallbackUrl('todoist-clone:///auth/callback?code=pkce-code')).toEqual({
      kind: 'code',
      code: 'pkce-code',
    });
  });

  it('ignores unrelated URLs, error redirects, and incomplete tokens', () => {
    expect(parseAuthCallbackUrl('todoist-clone://tasks/1?code=pkce-code')).toBeNull();
    expect(parseAuthCallbackUrl('https://example.com/auth/callback?code=pkce-code')).toBeNull();
    expect(parseAuthCallbackUrl('not a url')).toBeNull();
    expect(
      parseAuthCallbackUrl(
        `${EMAIL_CONFIRMATION_REDIRECT_TO}?error=access_denied&error_code=otp_expired`,
      ),
    ).toBeNull();
    expect(parseAuthCallbackUrl(`${EMAIL_CONFIRMATION_REDIRECT_TO}?access_token=at`)).toBeNull();
    expect(parseAuthCallbackUrl(`${EMAIL_CONFIRMATION_REDIRECT_TO}?code=`)).toBeNull();
    expect(parseAuthCallbackUrl(EMAIL_CONFIRMATION_REDIRECT_TO)).toBeNull();
  });
});

describe('createSessionFromAuthUrl', () => {
  const session = { access_token: 'access', refresh_token: 'refresh' };

  it('exchanges a PKCE code and sets a session from tokens', async () => {
    const auth = {
      exchangeCodeForSession: vi.fn().mockResolvedValue({
        data: { session },
        error: null,
      }),
      setSession: vi.fn().mockResolvedValue({
        data: { session },
        error: null,
      }),
    };

    await expect(
      createSessionFromAuthUrl(auth, `${EMAIL_CONFIRMATION_REDIRECT_TO}?code=pkce-code`),
    ).resolves.toBe(session);
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('pkce-code');

    await expect(
      createSessionFromAuthUrl(
        auth,
        `${EMAIL_CONFIRMATION_REDIRECT_TO}#access_token=at&refresh_token=rt`,
      ),
    ).resolves.toBe(session);
    expect(auth.setSession).toHaveBeenCalledWith({ access_token: 'at', refresh_token: 'rt' });
  });

  it('returns null for an unrelated URL and throws auth API errors', async () => {
    const auth = {
      exchangeCodeForSession: vi.fn().mockResolvedValue({
        data: { session: null },
        error: new AuthApiError('expired', 403, 'otp_expired'),
      }),
      setSession: vi.fn(),
    };

    await expect(createSessionFromAuthUrl(auth, 'todoist-clone://elsewhere')).resolves.toBeNull();
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();

    await expect(
      createSessionFromAuthUrl(auth, `${EMAIL_CONFIRMATION_REDIRECT_TO}?code=stale`),
    ).rejects.toMatchObject({ code: 'otp_expired' });
  });
});
