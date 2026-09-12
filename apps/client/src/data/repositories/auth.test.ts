import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AuthFailure, credentialsSchema, emailSchema, passwordSchema, toAuthFailure } from './auth';
import { AuthUrlError, parseAuthUrlError } from './auth-url';

describe('credentialsSchema', () => {
  it('normalises the email and enforces the minimum password length', () => {
    expect(credentialsSchema.parse({ email: '  Ada@Example.COM ', password: 'secret1' })).toEqual({
      email: 'ada@example.com',
      password: 'secret1',
    });
    expect(
      credentialsSchema.safeParse({ email: 'ada@example.com', password: 'short' }).success,
    ).toBe(false);
    expect(
      credentialsSchema.safeParse({ email: 'not-an-email', password: 'secret1' }).success,
    ).toBe(false);
  });
});

describe('emailSchema and passwordSchema', () => {
  it('normalises emails independently of a password', () => {
    expect(emailSchema.parse('  Ada@Example.COM ')).toBe('ada@example.com');
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
  });

  it('enforces the minimum password length', () => {
    expect(passwordSchema.parse('secret1')).toBe('secret1');
    expect(passwordSchema.safeParse('short').success).toBe(false);
  });
});

describe('toAuthFailure', () => {
  it('passes AuthFailure through unchanged', () => {
    const failure = new AuthFailure('email-taken');
    expect(toAuthFailure(failure)).toBe(failure);
  });

  it('maps Supabase error codes to app-level codes with user-facing messages', () => {
    const cases: Array<[string, AuthFailure['code']]> = [
      ['invalid_credentials', 'invalid-credentials'],
      ['email_not_confirmed', 'email-not-confirmed'],
      ['user_already_exists', 'email-taken'],
      ['email_exists', 'email-taken'],
      ['otp_expired', 'otp-expired'],
      ['otp-expired', 'otp-expired'],
      ['session_expired', 'session-expired'],
      ['session_not_found', 'session-expired'],
      ['reauthentication_needed', 'reauthentication-needed'],
      ['over_email_send_rate_limit', 'rate-limited'],
    ];
    for (const [supabaseCode, expected] of cases) {
      const failure = toAuthFailure(new AuthApiError('server text', 400, supabaseCode));
      expect(failure.code).toBe(expected);
      expect(failure.message).not.toBe('server text');
    }
  });

  it('relays the server message for input problems', () => {
    const weak = toAuthFailure(
      new AuthApiError('Password should be at least 6 characters.', 422, 'weak_password'),
    );
    expect(weak.code).toBe('weak-password');
    expect(weak.message).toBe('Password should be at least 6 characters.');

    const same = toAuthFailure(
      new AuthApiError(
        'New password should be different from the old password.',
        422,
        'same_password',
      ),
    );
    expect(same.code).toBe('same-password');
    expect(same.message).toBe('New password should be different from the old password.');
  });

  it('uses the first Zod issue as the message', () => {
    const result = credentialsSchema.safeParse({ email: 'x', password: 'secret1' });
    if (result.success) throw new Error('expected failure');
    const failure = toAuthFailure(result.error);
    expect(failure.code).toBe('invalid-input');
    expect(failure.message).toBe('Enter a valid email address.');
    expect(failure.cause).toBeInstanceOf(z.ZodError);
  });

  it('classifies fetch failures as network errors', () => {
    expect(toAuthFailure(new AuthRetryableFetchError('fetch failed', 0)).code).toBe('network');
  });

  it('falls back to rate-limited on HTTP 429 without a known code', () => {
    expect(toAuthFailure(new AuthApiError('slow down', 429, undefined)).code).toBe('rate-limited');
  });

  it('wraps anything else as unknown and keeps the cause', () => {
    const cause = new TypeError('boom');
    const failure = toAuthFailure(cause);
    expect(failure.code).toBe('unknown');
    expect(failure.cause).toBe(cause);
  });

  it('maps otp_expired from a parsed redirect URL', () => {
    const parsed = parseAuthUrlError(
      'https://app.example/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
    );
    expect(parsed).toBeInstanceOf(AuthUrlError);
    const failure = toAuthFailure(parsed);
    expect(failure.code).toBe('otp-expired');
    expect(failure.message).toBe('This link has expired. Request a new one and try again.');
    expect(failure.cause).toBe(parsed);
  });
});
