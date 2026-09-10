import { isAuthError, isAuthRetryableFetchError } from '@supabase/supabase-js';
import { z } from 'zod';

/** What the UI may know about the signed-in user. Sessions and tokens stay in the data layer. */
export interface AuthUser {
  id: string;
  email: string | null;
}

/**
 * - `restoring`: reading the stored session on startup. Nothing is rendered yet so guest tasks
 *   never flash before an account view.
 * - `restore-failed`: the stored session could not be resolved (typically offline with an
 *   expired token). The user can retry or explicitly continue as guest.
 */
export type AuthState =
  | { status: 'restoring' }
  | { status: 'restore-failed'; error: AuthFailure }
  | { status: 'signed-out' }
  | { status: 'signed-in'; user: AuthUser };

// Supabase's default minimum password length.
export const MIN_PASSWORD_LENGTH = 6;

export const credentialsSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: 'Enter a valid email address.' })),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, { error: `Use at least ${MIN_PASSWORD_LENGTH} characters.` }),
});

export type Credentials = z.infer<typeof credentialsSchema>;

/** Six-digit code from the "Confirm signup" email (`{{ .Token }}`). */
export const verificationCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, { error: 'Enter the 6-digit code from your email.' });

export type AuthFailureCode =
  | 'invalid-input'
  | 'invalid-credentials'
  | 'email-not-confirmed'
  | 'email-taken'
  | 'weak-password'
  | 'invalid-code'
  | 'rate-limited'
  | 'network'
  | 'unknown';

/**
 * Every auth operation rejects with an `AuthFailure`. `message` is safe to show to users;
 * `code` lets screens branch (e.g. offer verification after `email-not-confirmed`).
 */
export class AuthFailure extends Error {
  override readonly name = 'AuthFailure';

  constructor(
    readonly code: AuthFailureCode,
    message: string = DEFAULT_MESSAGES[code],
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

const DEFAULT_MESSAGES: Record<AuthFailureCode, string> = {
  'invalid-input': 'Check your details and try again.',
  'invalid-credentials': 'Incorrect email or password.',
  'email-not-confirmed': 'Confirm your email address to sign in.',
  'email-taken': 'An account with this email already exists. Sign in instead.',
  'weak-password': `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
  'invalid-code': 'That code is invalid or has expired. Request a new one.',
  'rate-limited': 'Too many attempts. Wait a moment and try again.',
  network: 'Couldn’t reach the server. Check your connection and try again.',
  unknown: 'Something went wrong. Try again.',
};

// https://supabase.com/docs/guides/auth/debugging/error-codes
const SUPABASE_ERROR_CODES: Record<string, AuthFailureCode> = {
  invalid_credentials: 'invalid-credentials',
  email_not_confirmed: 'email-not-confirmed',
  user_already_exists: 'email-taken',
  email_exists: 'email-taken',
  weak_password: 'weak-password',
  otp_expired: 'invalid-code',
  over_request_rate_limit: 'rate-limited',
  over_email_send_rate_limit: 'rate-limited',
  validation_failed: 'invalid-input',
  email_address_invalid: 'invalid-input',
};

// Server messages worth relaying verbatim (they explain *what* is wrong with the input).
const RELAY_SERVER_MESSAGE = new Set<AuthFailureCode>(['weak-password', 'invalid-input']);

/** Translates any thrown value (Supabase error, Zod error, network failure) into an AuthFailure. */
export function toAuthFailure(error: unknown): AuthFailure {
  if (error instanceof AuthFailure) return error;
  if (error instanceof z.ZodError) {
    return new AuthFailure('invalid-input', error.issues[0]?.message, { cause: error });
  }
  if (isAuthRetryableFetchError(error)) {
    return new AuthFailure('network', undefined, { cause: error });
  }
  if (isAuthError(error)) {
    const code = error.code ? SUPABASE_ERROR_CODES[error.code] : undefined;
    if (code) {
      return new AuthFailure(code, RELAY_SERVER_MESSAGE.has(code) ? error.message : undefined, {
        cause: error,
      });
    }
    if (error.status === 429) return new AuthFailure('rate-limited', undefined, { cause: error });
  }
  return new AuthFailure('unknown', undefined, { cause: error });
}
