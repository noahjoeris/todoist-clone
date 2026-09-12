import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMAIL_CONFIRMATION_REDIRECT_TO } from '../supabase/auth-callback';
import type { RegisterAuthDeepLink } from '../supabase/auth-deep-link';
import { AuthFailure } from './auth';
import { type AuthClient, createAuthRepository } from './auth-repository';
import { AuthUrlError } from './auth-url';

const credentials = { email: 'ada@example.com', password: 'secret1' };

function session(overrides: Partial<Session['user']> = {}): Session {
  return {
    access_token: 'access',
    refresh_token: 'refresh',
    expires_in: 3600,
    token_type: 'bearer',
    user: {
      id: 'user-1',
      email: 'ada@example.com',
      aud: 'authenticated',
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-01-01T00:00:00Z',
      ...overrides,
    },
  } as Session;
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (e: unknown) => void;
};
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('auth repository', () => {
  const unsubscribe = vi.fn();
  const unregisterLifecycle = vi.fn();
  const unregisterDeepLink = vi.fn();
  const registerLifecycle = vi.fn(() => unregisterLifecycle);
  let handleDeepLink!: (url: string) => Promise<boolean>;
  const registerDeepLink = vi.fn<RegisterAuthDeepLink>((onUrl) => {
    handleDeepLink = onUrl;
    return unregisterDeepLink;
  });
  let emitAuthEvent: (event: AuthChangeEvent, session: Session | null) => void;

  const auth = {
    getSession: vi.fn(),
    onAuthStateChange: vi.fn((callback) => {
      emitAuthEvent = callback;
      return { data: { subscription: { id: 'sub', callback, unsubscribe } } };
    }),
    signUp: vi.fn(),
    signInWithPassword: vi.fn(),
    resend: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    updateUser: vi.fn(),
    signOut: vi.fn(),
    startAutoRefresh: vi.fn(),
    stopAutoRefresh: vi.fn(),
    exchangeCodeForSession: vi.fn(),
    setSession: vi.fn(),
  } as unknown as { [K in keyof AuthClient]: ReturnType<typeof vi.fn> } & AuthClient;

  function createRepository(options?: Parameters<typeof createAuthRepository>[2]) {
    return createAuthRepository(auth, registerLifecycle, {
      emailRedirectTo: EMAIL_CONFIRMATION_REDIRECT_TO,
      registerDeepLink,
      ...options,
    });
  }

  async function createSignedInRepository() {
    auth.getSession.mockResolvedValue({ data: { session: session() }, error: null });
    const repository = createRepository();
    await repository.restoreSession();
    return repository;
  }

  beforeEach(() => {
    vi.resetAllMocks();
    registerLifecycle.mockReturnValue(unregisterLifecycle);
    registerDeepLink.mockImplementation((onUrl) => {
      handleDeepLink = onUrl;
      return unregisterDeepLink;
    });
    auth.onAuthStateChange.mockImplementation((callback) => {
      emitAuthEvent = callback;
      return { data: { subscription: { id: 'sub', callback, unsubscribe } } };
    });
  });

  describe('session restoration', () => {
    it('starts restoring and exposes only id and email of a stored session', async () => {
      auth.getSession.mockResolvedValue({ data: { session: session() }, error: null });
      const repository = createRepository();
      expect(repository.getState()).toEqual({ status: 'restoring' });

      await repository.restoreSession();

      expect(repository.getState()).toEqual({
        status: 'signed-in',
        user: { id: 'user-1', email: 'ada@example.com' },
      });
    });

    it('is signed out when no session is stored', async () => {
      auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
      const repository = createRepository();
      await repository.restoreSession();
      expect(repository.getState()).toEqual({ status: 'signed-out' });
    });

    it('attaches a URL redirect error when restore finds no session', async () => {
      auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
      const urlAuthError = new AuthUrlError('otp_expired', 'Email link is invalid or has expired');
      const repository = createAuthRepository(auth, registerLifecycle, { urlAuthError });
      await repository.restoreSession();

      const state = repository.getState();
      expect(state.status).toBe('signed-out');
      if (state.status !== 'signed-out') throw new Error('expected signed-out');
      expect(state.redirectError).toMatchObject({
        code: 'otp-expired',
        message: 'This link has expired. Request a new one and try again.',
      });
    });

    it('attaches a URL redirect error even if SIGNED_OUT fires during getSession', async () => {
      const pending = deferred<{ data: { session: Session | null }; error: null }>();
      auth.getSession.mockReturnValue(pending.promise);
      const urlAuthError = new AuthUrlError('otp_expired', 'Email link is invalid or has expired');
      const repository = createAuthRepository(auth, registerLifecycle, { urlAuthError });
      const restoration = repository.restoreSession();

      emitAuthEvent('SIGNED_OUT', null);
      expect(repository.getState()).toEqual({ status: 'restoring' });

      pending.resolve({ data: { session: null }, error: null });
      await restoration;

      const state = repository.getState();
      expect(state.status).toBe('signed-out');
      if (state.status !== 'signed-out') throw new Error('expected signed-out');
      expect(state.redirectError).toMatchObject({
        code: 'otp-expired',
        message: 'This link has expired. Request a new one and try again.',
      });
    });

    it('ignores a URL redirect error when a session is restored', async () => {
      auth.getSession.mockResolvedValue({ data: { session: session() }, error: null });
      const repository = createAuthRepository(auth, registerLifecycle, {
        urlAuthError: new AuthUrlError('otp_expired', 'expired'),
      });
      await repository.restoreSession();
      expect(repository.getState()).toEqual({
        status: 'signed-in',
        user: { id: 'user-1', email: 'ada@example.com' },
      });
    });

    it('prefers a session restore failure over a URL redirect error', async () => {
      auth.getSession.mockResolvedValue({
        data: { session: null },
        error: new AuthRetryableFetchError('fetch failed', 0),
      });
      const repository = createAuthRepository(auth, registerLifecycle, {
        urlAuthError: new AuthUrlError('otp_expired', 'expired'),
      });
      await repository.restoreSession();
      const state = repository.getState();
      expect(state.status).toBe('restore-failed');
      if (state.status !== 'restore-failed') throw new Error('expected restore-failed');
      expect(state.error.code).toBe('network');
    });

    it('reports a failed restoration without discarding anything', async () => {
      auth.getSession.mockResolvedValue({
        data: { session: null },
        error: new AuthRetryableFetchError('fetch failed', 0),
      });
      const repository = createRepository();
      await repository.restoreSession();

      const state = repository.getState();
      expect(state.status).toBe('restore-failed');
      if (state.status !== 'restore-failed') throw new Error('expected restore-failed');
      expect(state.error.code).toBe('network');
      expect(auth.signOut).not.toHaveBeenCalled();
    });

    it('recovers when a retry succeeds', async () => {
      auth.getSession.mockResolvedValueOnce({
        data: { session: null },
        error: new AuthRetryableFetchError('fetch failed', 0),
      });
      const repository = createRepository();
      await repository.restoreSession();

      auth.getSession.mockResolvedValueOnce({ data: { session: session() }, error: null });
      const retry = repository.restoreSession();
      expect(repository.getState()).toEqual({ status: 'restoring' });
      await retry;
      expect(repository.getState().status).toBe('signed-in');
    });

    it('dedupes concurrent restoration calls', async () => {
      const pending = deferred<{ data: { session: Session | null }; error: null }>();
      auth.getSession.mockReturnValue(pending.promise);
      const repository = createRepository();

      const first = repository.restoreSession();
      const second = repository.restoreSession();
      pending.resolve({ data: { session: null }, error: null });
      await Promise.all([first, second]);

      expect(auth.getSession).toHaveBeenCalledTimes(1);
    });

    it('ignores a late restoration result after the user continued as guest', async () => {
      const pending = deferred<{ data: { session: Session | null }; error: null }>();
      auth.getSession.mockReturnValue(pending.promise);
      const repository = createRepository();
      const restoration = repository.restoreSession();

      repository.continueAsGuest();
      expect(repository.getState()).toEqual({ status: 'signed-out' });

      pending.resolve({ data: { session: session() }, error: null });
      await restoration;
      emitAuthEvent('SIGNED_IN', session());

      expect(repository.getState()).toEqual({ status: 'signed-out' });
    });

    it('starts a fresh restoration after continuing as guest, even if one is still in flight', async () => {
      const stale = deferred<{ data: { session: Session | null }; error: null }>();
      auth.getSession.mockReturnValueOnce(stale.promise);
      auth.getSession.mockResolvedValueOnce({ data: { session: session() }, error: null });
      const repository = createRepository();
      void repository.restoreSession();
      repository.continueAsGuest();

      await repository.restoreSession();

      expect(auth.getSession).toHaveBeenCalledTimes(2);
      expect(repository.getState().status).toBe('signed-in');
      stale.resolve({ data: { session: null }, error: null });
      await Promise.resolve();
      expect(repository.getState().status).toBe('signed-in');
    });

    it('applies sessions again once the user signs in explicitly', async () => {
      auth.getSession.mockResolvedValue({
        data: { session: null },
        error: new AuthRetryableFetchError('fetch failed', 0),
      });
      const repository = createRepository();
      await repository.restoreSession();
      repository.continueAsGuest();

      auth.signInWithPassword.mockResolvedValue({ data: { session: session() }, error: null });
      await repository.signIn(credentials);

      expect(repository.getState().status).toBe('signed-in');
    });

    it('keeps ignoring a stored session after a failed sign-in from guest', async () => {
      auth.getSession.mockResolvedValue({
        data: { session: null },
        error: new AuthRetryableFetchError('fetch failed', 0),
      });
      const repository = createRepository();
      await repository.restoreSession();
      repository.continueAsGuest();

      auth.signInWithPassword.mockResolvedValue({
        data: { session: null, user: null },
        error: new AuthApiError('Invalid login credentials', 400, 'invalid_credentials'),
      });
      await expect(repository.signIn(credentials)).rejects.toMatchObject({
        code: 'invalid-credentials',
      });

      emitAuthEvent('TOKEN_REFRESHED', session());
      expect(repository.getState()).toEqual({ status: 'signed-out' });
    });

    it('keeps ignoring a stored session when sign-up needs confirmation', async () => {
      auth.getSession.mockResolvedValue({
        data: { session: null },
        error: new AuthRetryableFetchError('fetch failed', 0),
      });
      const repository = createRepository();
      await repository.restoreSession();
      repository.continueAsGuest();

      auth.signUp.mockResolvedValue({
        data: { user: { id: 'user-1', identities: [{ id: 'i' }] }, session: null },
        error: null,
      });
      await expect(repository.signUp(credentials)).resolves.toBe('confirmation-required');

      emitAuthEvent('TOKEN_REFRESHED', session());
      expect(repository.getState()).toEqual({ status: 'signed-out' });
    });
  });

  describe('sign up', () => {
    it('requires confirmation when Supabase returns no session', async () => {
      auth.signUp.mockResolvedValue({
        data: { user: { id: 'user-1', identities: [{ id: 'i' }] }, session: null },
        error: null,
      });
      const repository = createRepository();

      await expect(repository.signUp(credentials)).resolves.toBe('confirmation-required');
      expect(auth.signUp).toHaveBeenCalledWith({
        ...credentials,
        options: { emailRedirectTo: EMAIL_CONFIRMATION_REDIRECT_TO },
      });
    });

    it('signs in directly when confirmations are disabled', async () => {
      auth.signUp.mockResolvedValue({
        data: { user: session().user, session: session() },
        error: null,
      });
      const repository = createRepository();

      await expect(repository.signUp(credentials)).resolves.toBe('signed-in');
      expect(repository.getState().status).toBe('signed-in');
    });

    it('detects an existing email hidden behind an obfuscated user', async () => {
      auth.signUp.mockResolvedValue({
        data: { user: { id: 'fake', identities: [] }, session: null },
        error: null,
      });
      const repository = createRepository();

      await expect(repository.signUp(credentials)).rejects.toMatchObject({ code: 'email-taken' });
    });

    it('validates credentials before contacting Supabase', async () => {
      const repository = createRepository();
      await expect(repository.signUp({ email: 'nope', password: 'secret1' })).rejects.toMatchObject(
        {
          code: 'invalid-input',
          message: 'Enter a valid email address.',
        },
      );
      expect(auth.signUp).not.toHaveBeenCalled();
    });

    it('maps Supabase errors', async () => {
      auth.signUp.mockResolvedValue({
        data: { user: null, session: null },
        error: new AuthApiError('weak', 422, 'weak_password'),
      });
      const repository = createRepository();
      await expect(repository.signUp(credentials)).rejects.toMatchObject({ code: 'weak-password' });
    });
  });

  describe('sign in', () => {
    it('surfaces invalid credentials and leaves the state untouched', async () => {
      auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
      auth.signInWithPassword.mockResolvedValue({
        data: { session: null, user: null },
        error: new AuthApiError('Invalid login credentials', 400, 'invalid_credentials'),
      });
      const repository = createRepository();
      await repository.restoreSession();

      const failure = await repository.signIn(credentials).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(AuthFailure);
      expect((failure as AuthFailure).code).toBe('invalid-credentials');
      expect(repository.getState()).toEqual({ status: 'signed-out' });
    });

    it('reports an unconfirmed email so the UI can offer to resend the link', async () => {
      auth.signInWithPassword.mockResolvedValue({
        data: { session: null, user: null },
        error: new AuthApiError('Email not confirmed', 400, 'email_not_confirmed'),
      });
      const repository = createRepository();
      await expect(repository.signIn(credentials)).rejects.toMatchObject({
        code: 'email-not-confirmed',
      });
    });
  });

  describe('confirmation email', () => {
    it('resends the signup link and maps rate limits', async () => {
      auth.resend.mockResolvedValueOnce({ data: {}, error: null });
      const repository = createRepository();
      await repository.resendConfirmation('ada@example.com');
      expect(auth.resend).toHaveBeenCalledWith({
        type: 'signup',
        email: 'ada@example.com',
        options: { emailRedirectTo: EMAIL_CONFIRMATION_REDIRECT_TO },
      });

      auth.resend.mockResolvedValueOnce({
        data: {},
        error: new AuthApiError('rate limit', 429, 'over_email_send_rate_limit'),
      });
      await expect(repository.resendConfirmation('ada@example.com')).rejects.toMatchObject({
        code: 'rate-limited',
      });
    });
  });

  describe('password reset', () => {
    it('emails a recovery link and normalises the address', async () => {
      auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
      const repository = createRepository();

      await repository.requestPasswordReset('  Ada@Example.COM ');

      expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('ada@example.com', {
        redirectTo: EMAIL_CONFIRMATION_REDIRECT_TO,
      });
    });

    it('omits redirectTo when the platform does not supply a callback URL', async () => {
      auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
      const repository = createAuthRepository(auth, registerLifecycle);

      await repository.requestPasswordReset('ada@example.com');

      expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('ada@example.com', {});
    });

    it('validates the email before contacting Supabase', async () => {
      const repository = createRepository();
      await expect(repository.requestPasswordReset('nope')).rejects.toMatchObject({
        code: 'invalid-input',
        message: 'Enter a valid email address.',
      });
      expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
    });

    it('maps rate limits', async () => {
      auth.resetPasswordForEmail.mockResolvedValue({
        data: {},
        error: new AuthApiError('rate limit', 429, 'over_email_send_rate_limit'),
      });
      const repository = createRepository();
      await expect(repository.requestPasswordReset('ada@example.com')).rejects.toMatchObject({
        code: 'rate-limited',
      });
    });
  });

  describe('update password', () => {
    it('saves the new password and clears a recovery flag', async () => {
      auth.getSession.mockResolvedValue({ data: { session: session() }, error: null });
      const repository = createAuthRepository(auth, registerLifecycle, {
        passwordRecoveryFromUrl: true,
      });
      await repository.restoreSession();
      expect(repository.getState()).toEqual({
        status: 'signed-in',
        user: { id: 'user-1', email: 'ada@example.com' },
        passwordRecovery: true,
      });

      auth.updateUser.mockResolvedValue({ data: { user: session().user }, error: null });
      await repository.updatePassword('secret2');

      expect(auth.updateUser).toHaveBeenCalledWith({ password: 'secret2' });
      expect(repository.getState()).toEqual({
        status: 'signed-in',
        user: { id: 'user-1', email: 'ada@example.com' },
      });
    });

    it('validates the password before contacting Supabase', async () => {
      const repository = await createSignedInRepository();
      await expect(repository.updatePassword('short')).rejects.toMatchObject({
        code: 'invalid-input',
      });
      expect(auth.updateUser).not.toHaveBeenCalled();
    });

    it('maps same_password', async () => {
      const repository = await createSignedInRepository();
      auth.updateUser.mockResolvedValue({
        data: { user: null },
        error: new AuthApiError('same password', 422, 'same_password'),
      });
      await expect(repository.updatePassword('secret1')).rejects.toMatchObject({
        code: 'same-password',
      });
    });
  });

  describe('update email', () => {
    it('requests a change and passes emailRedirectTo when provided', async () => {
      const repository = createAuthRepository(auth, registerLifecycle, {
        emailRedirectTo: 'todoist-clone://auth/callback',
      });
      auth.getSession.mockResolvedValue({ data: { session: session() }, error: null });
      await repository.restoreSession();
      auth.updateUser.mockResolvedValue({ data: { user: session().user }, error: null });

      await repository.updateEmail('  New@Example.COM ');

      expect(auth.updateUser).toHaveBeenCalledWith(
        { email: 'new@example.com' },
        { emailRedirectTo: 'todoist-clone://auth/callback' },
      );
    });

    it('rejects the current address without contacting Supabase', async () => {
      const repository = await createSignedInRepository();
      await expect(repository.updateEmail('ada@example.com')).rejects.toMatchObject({
        code: 'invalid-input',
        message: 'Enter a different email address.',
      });
      expect(auth.updateUser).not.toHaveBeenCalled();
    });

    it('maps a taken address', async () => {
      const repository = await createSignedInRepository();
      auth.updateUser.mockResolvedValue({
        data: { user: null },
        error: new AuthApiError('already exists', 422, 'email_exists'),
      });
      await expect(repository.updateEmail('taken@example.com')).rejects.toMatchObject({
        code: 'email-taken',
      });
    });
  });

  describe('sign out', () => {
    it('ends only the local session and returns to guest mode', async () => {
      const repository = await createSignedInRepository();
      auth.signOut.mockResolvedValue({ error: null });

      await repository.signOut();

      expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
      expect(repository.getState()).toEqual({ status: 'signed-out' });
    });

    it('returns to guest mode even when the revoke request fails', async () => {
      const repository = await createSignedInRepository();
      auth.signOut.mockResolvedValue({ error: new AuthRetryableFetchError('offline', 0) });

      await expect(repository.signOut()).rejects.toMatchObject({ code: 'network' });
      expect(repository.getState()).toEqual({ status: 'signed-out' });

      emitAuthEvent('TOKEN_REFRESHED', session());
      expect(repository.getState()).toEqual({ status: 'signed-out' });
    });
  });

  describe('auth events', () => {
    it('follows sign-outs and refreshes emitted by Supabase', async () => {
      const repository = await createSignedInRepository();

      emitAuthEvent('TOKEN_REFRESHED', session({ email: 'new@example.com' }));
      expect(repository.getState()).toEqual({
        status: 'signed-in',
        user: { id: 'user-1', email: 'new@example.com' },
      });

      emitAuthEvent('SIGNED_OUT', null);
      expect(repository.getState()).toEqual({ status: 'signed-out' });
    });

    it('marks a PASSWORD_RECOVERY session so the UI can collect a new password', async () => {
      const repository = await createSignedInRepository();

      emitAuthEvent('PASSWORD_RECOVERY', session());

      expect(repository.getState()).toEqual({
        status: 'signed-in',
        user: { id: 'user-1', email: 'ada@example.com' },
        passwordRecovery: true,
      });
    });

    it('keeps passwordRecovery across token refreshes until the password is updated', async () => {
      auth.getSession.mockResolvedValue({ data: { session: session() }, error: null });
      const repository = createAuthRepository(auth, registerLifecycle, {
        passwordRecoveryFromUrl: true,
      });
      await repository.restoreSession();

      emitAuthEvent('TOKEN_REFRESHED', session({ email: 'ada@example.com' }));
      expect(repository.getState()).toMatchObject({ passwordRecovery: true });

      auth.updateUser.mockResolvedValue({ data: { user: session().user }, error: null });
      await repository.updatePassword('secret2');
      emitAuthEvent('USER_UPDATED', session());
      expect(repository.getState()).toEqual({
        status: 'signed-in',
        user: { id: 'user-1', email: 'ada@example.com' },
      });
    });

    it('does not treat a later sign-in as recovery when the URL type had no session', async () => {
      auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
      const repository = createAuthRepository(auth, registerLifecycle, {
        passwordRecoveryFromUrl: true,
      });
      await repository.restoreSession();
      expect(repository.getState()).toEqual({ status: 'signed-out' });

      auth.signInWithPassword.mockResolvedValue({ data: { session: session() }, error: null });
      await repository.signIn(credentials);
      expect(repository.getState()).toEqual({
        status: 'signed-in',
        user: { id: 'user-1', email: 'ada@example.com' },
      });
    });

    it('stashes PASSWORD_RECOVERY during restore and applies it with the session', async () => {
      const pending = deferred<{ data: { session: Session | null }; error: null }>();
      auth.getSession.mockReturnValue(pending.promise);
      const repository = createRepository();
      const restoration = repository.restoreSession();

      emitAuthEvent('PASSWORD_RECOVERY', session());
      expect(repository.getState()).toEqual({ status: 'restoring' });

      pending.resolve({ data: { session: session() }, error: null });
      await restoration;

      expect(repository.getState()).toEqual({
        status: 'signed-in',
        user: { id: 'user-1', email: 'ada@example.com' },
        passwordRecovery: true,
      });
    });

    it('leaves startup to restoreSession', async () => {
      const pending = deferred<{ data: { session: Session | null }; error: null }>();
      auth.getSession.mockReturnValue(pending.promise);
      const repository = createRepository();
      const restoration = repository.restoreSession();

      emitAuthEvent('INITIAL_SESSION', session());
      emitAuthEvent('SIGNED_IN', session());
      emitAuthEvent('SIGNED_OUT', null);
      expect(repository.getState()).toEqual({ status: 'restoring' });

      pending.resolve({ data: { session: null }, error: null });
      await restoration;
      expect(repository.getState()).toEqual({ status: 'signed-out' });
    });

    it('keeps a redirectError if SIGNED_OUT arrives after a no-session restore', async () => {
      auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
      const repository = createAuthRepository(auth, registerLifecycle, {
        urlAuthError: new AuthUrlError('otp_expired', 'expired'),
      });
      await repository.restoreSession();

      emitAuthEvent('SIGNED_OUT', null);

      const state = repository.getState();
      expect(state.status).toBe('signed-out');
      if (state.status !== 'signed-out') throw new Error('expected signed-out');
      expect(state.redirectError).toMatchObject({ code: 'otp-expired' });
    });
  });

  describe('subscriptions and cleanup', () => {
    it('notifies listeners until they unsubscribe', async () => {
      auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
      const repository = createRepository();
      const listener = vi.fn();
      const stop = repository.subscribe(listener);

      await repository.restoreSession();
      expect(listener).toHaveBeenLastCalledWith({ status: 'signed-out' });

      stop();
      repository.continueAsGuest();
      expect(listener).toHaveBeenCalledTimes(2);
    });

    it('registers the platform lifecycle and tears everything down on dispose', () => {
      const repository = createRepository();
      expect(registerLifecycle).toHaveBeenCalledWith(auth);
      expect(registerDeepLink).toHaveBeenCalledTimes(1);

      repository.dispose();

      expect(unsubscribe).toHaveBeenCalledTimes(1);
      expect(unregisterLifecycle).toHaveBeenCalledTimes(1);
      expect(unregisterDeepLink).toHaveBeenCalledTimes(1);
    });
  });

  describe('confirmation deep link', () => {
    it('signs in from a PKCE callback even after continue-as-guest', async () => {
      auth.getSession.mockResolvedValue({
        data: { session: null },
        error: new AuthRetryableFetchError('fetch failed', 0),
      });
      auth.exchangeCodeForSession.mockResolvedValue({
        data: { session: session() },
        error: null,
      });
      const repository = createRepository();
      await repository.restoreSession();
      repository.continueAsGuest();

      await handleDeepLink(`${EMAIL_CONFIRMATION_REDIRECT_TO}?code=pkce-code`);

      expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('pkce-code');
      expect(repository.getState()).toEqual({
        status: 'signed-in',
        user: { id: 'user-1', email: 'ada@example.com' },
      });
    });

    it('sets a session from implicit callback tokens', async () => {
      auth.setSession.mockResolvedValue({ data: { session: session() }, error: null });
      const repository = createRepository();

      await handleDeepLink(`${EMAIL_CONFIRMATION_REDIRECT_TO}#access_token=at&refresh_token=rt`);

      expect(auth.setSession).toHaveBeenCalledWith({
        access_token: 'at',
        refresh_token: 'rt',
      });
      expect(repository.getState().status).toBe('signed-in');
    });

    it('ignores unrelated URLs and leaves state unchanged on exchange failure', async () => {
      auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
      auth.exchangeCodeForSession.mockResolvedValue({
        data: { session: null },
        error: new AuthApiError('expired', 403, 'otp_expired'),
      });
      const repository = createRepository();
      await repository.restoreSession();
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await handleDeepLink('todoist-clone://elsewhere');
      expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
      expect(repository.getState()).toEqual({ status: 'signed-out' });

      await handleDeepLink(`${EMAIL_CONFIRMATION_REDIRECT_TO}?code=stale`);
      expect(repository.getState()).toEqual({ status: 'signed-out' });
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it('does not let a late restore overwrite a session from the confirmation link', async () => {
      const pending = deferred<{ data: { session: Session | null }; error: null }>();
      auth.getSession.mockReturnValue(pending.promise);
      auth.exchangeCodeForSession.mockResolvedValue({
        data: { session: session() },
        error: null,
      });
      const repository = createRepository();
      const restoration = repository.restoreSession();

      await handleDeepLink(`${EMAIL_CONFIRMATION_REDIRECT_TO}?code=pkce-code`);
      expect(repository.getState().status).toBe('signed-in');

      pending.resolve({ data: { session: null }, error: null });
      await restoration;
      expect(repository.getState().status).toBe('signed-in');
    });

    it('stays restoring until a cold-start confirmation exchange finishes', async () => {
      const pendingRestore = deferred<{ data: { session: Session | null }; error: null }>();
      const pendingExchange = deferred<{ data: { session: Session | null }; error: null }>();
      auth.getSession.mockReturnValue(pendingRestore.promise);
      auth.exchangeCodeForSession.mockReturnValue(pendingExchange.promise);
      const repository = createRepository();
      const restoration = repository.restoreSession();

      const apply = handleDeepLink(`${EMAIL_CONFIRMATION_REDIRECT_TO}?code=pkce-code`);
      expect(repository.getState().status).toBe('restoring');

      pendingRestore.resolve({ data: { session: null }, error: null });
      await restoration;
      expect(repository.getState().status).toBe('restoring');

      pendingExchange.resolve({ data: { session: session() }, error: null });
      await apply;
      expect(repository.getState()).toEqual({
        status: 'signed-in',
        user: { id: 'user-1', email: 'ada@example.com' },
      });
    });

    it('does not stay restoring when confirmation exchange fails during restore', async () => {
      const pendingRestore = deferred<{ data: { session: Session | null }; error: null }>();
      const pendingExchange = deferred<{
        data: { session: Session | null };
        error: AuthApiError;
      }>();
      auth.getSession.mockReturnValue(pendingRestore.promise);
      auth.exchangeCodeForSession.mockReturnValue(pendingExchange.promise);
      const repository = createRepository();
      const restoration = repository.restoreSession();
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const apply = handleDeepLink(`${EMAIL_CONFIRMATION_REDIRECT_TO}?code=stale`);
      pendingRestore.resolve({ data: { session: null }, error: null });
      await restoration;
      expect(repository.getState().status).toBe('restoring');

      pendingExchange.resolve({
        data: { session: null },
        error: new AuthApiError('expired', 403, 'otp_expired'),
      });
      await apply;

      expect(repository.getState()).toEqual({ status: 'signed-out' });
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it('omits emailRedirectTo when the platform does not supply one', async () => {
      auth.signUp.mockResolvedValue({
        data: { user: { id: 'user-1', identities: [{ id: 'i' }] }, session: null },
        error: null,
      });
      const repository = createAuthRepository(auth, registerLifecycle);

      await repository.signUp(credentials);
      expect(auth.signUp).toHaveBeenCalledWith(credentials);
    });
  });
});
