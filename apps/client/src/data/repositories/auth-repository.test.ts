import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  const registerLifecycle = vi.fn(() => unregisterLifecycle);
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
    signOut: vi.fn(),
    startAutoRefresh: vi.fn(),
    stopAutoRefresh: vi.fn(),
  } as unknown as { [K in keyof AuthClient]: ReturnType<typeof vi.fn> } & AuthClient;

  function createRepository() {
    return createAuthRepository(auth, registerLifecycle);
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
      expect(auth.signUp).toHaveBeenCalledWith(credentials);
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
      expect(auth.resend).toHaveBeenCalledWith({ type: 'signup', email: 'ada@example.com' });

      auth.resend.mockResolvedValueOnce({
        data: {},
        error: new AuthApiError('rate limit', 429, 'over_email_send_rate_limit'),
      });
      await expect(repository.resendConfirmation('ada@example.com')).rejects.toMatchObject({
        code: 'rate-limited',
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

    it('leaves startup to restoreSession', async () => {
      const pending = deferred<{ data: { session: Session | null }; error: null }>();
      auth.getSession.mockReturnValue(pending.promise);
      const repository = createRepository();
      const restoration = repository.restoreSession();

      emitAuthEvent('INITIAL_SESSION', session());
      emitAuthEvent('SIGNED_IN', session());
      expect(repository.getState()).toEqual({ status: 'restoring' });

      pending.resolve({ data: { session: null }, error: null });
      await restoration;
      expect(repository.getState()).toEqual({ status: 'signed-out' });
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

      repository.dispose();

      expect(unsubscribe).toHaveBeenCalledTimes(1);
      expect(unregisterLifecycle).toHaveBeenCalledTimes(1);
    });
  });
});
