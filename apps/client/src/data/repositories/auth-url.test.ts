import { describe, expect, it } from 'vitest';
import { AuthUrlError, parseAuthUrlError, parseAuthUrlType } from './auth-url';

describe('parseAuthUrlError', () => {
  it('reads error params from the URL fragment', () => {
    const parsed = parseAuthUrlError(
      'https://app.example/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
    );
    expect(parsed).toBeInstanceOf(AuthUrlError);
    expect(parsed).toMatchObject({
      code: 'otp_expired',
      message: 'Email link is invalid or has expired',
    });
  });

  it('reads error params from the query string', () => {
    const parsed = parseAuthUrlError(
      'https://app.example/?error=access_denied&error_code=otp_expired&error_description=Email%20link%20is%20invalid%20or%20has%20expired',
    );
    expect(parsed?.code).toBe('otp_expired');
    expect(parsed?.message).toBe('Email link is invalid or has expired');
  });

  it('lets query values override the same keys in the fragment', () => {
    const parsed = parseAuthUrlError(
      'https://app.example/?error_code=otp_expired#error_code=other&error_description=from+hash',
    );
    expect(parsed?.code).toBe('otp_expired');
    expect(parsed?.message).toBe('from hash');
  });

  it('prefers error_code over error when both are present', () => {
    expect(
      parseAuthUrlError('https://app.example/#error=access_denied&error_code=otp_expired')?.code,
    ).toBe('otp_expired');
  });

  it('falls back to the error param when error_code is missing', () => {
    expect(parseAuthUrlError('https://app.example/#error=access_denied')?.code).toBe(
      'access_denied',
    );
  });

  it('returns null when the URL has no auth error params', () => {
    expect(parseAuthUrlError('https://app.example/')).toBeNull();
    expect(parseAuthUrlError('https://app.example/#access_token=abc&refresh_token=def')).toBeNull();
    expect(parseAuthUrlError('not a url')).toBeNull();
  });

  it('treats blank error params as absent', () => {
    expect(
      parseAuthUrlError('https://app.example/#error=&error_code=&error_description='),
    ).toBeNull();
  });
});

describe('parseAuthUrlType', () => {
  it('reads type from the fragment (implicit recovery / email-change redirects)', () => {
    expect(
      parseAuthUrlType(
        'https://app.example/#access_token=abc&expires_in=3600&refresh_token=def&token_type=bearer&type=recovery',
      ),
    ).toBe('recovery');
    expect(parseAuthUrlType('https://app.example/#type=email_change&access_token=abc')).toBe(
      'email_change',
    );
  });

  it('reads type from the query string', () => {
    expect(parseAuthUrlType('https://app.example/?code=pkce&type=recovery')).toBe('recovery');
  });

  it('lets query values override the fragment', () => {
    expect(parseAuthUrlType('https://app.example/?type=recovery#type=signup')).toBe('recovery');
  });

  it('reads type from the native callback scheme', () => {
    expect(parseAuthUrlType('todoist-clone://auth/callback#access_token=abc&type=recovery')).toBe(
      'recovery',
    );
  });

  it('returns undefined when type is missing or blank', () => {
    expect(parseAuthUrlType('https://app.example/#access_token=abc')).toBeUndefined();
    expect(parseAuthUrlType('https://app.example/#type=')).toBeUndefined();
    expect(parseAuthUrlType('not a url')).toBeUndefined();
  });
});
