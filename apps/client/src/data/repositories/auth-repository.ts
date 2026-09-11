import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { createSessionFromAuthUrl, parseAuthCallbackUrl } from '../supabase/auth-callback';
import type { RegisterAuthDeepLink } from '../supabase/auth-deep-link';
import {
  AuthFailure,
  type AuthState,
  type AuthUser,
  type Credentials,
  credentialsSchema,
  toAuthFailure,
} from './auth';

export type SignUpOutcome = 'confirmation-required' | 'signed-in';

export interface AuthRepository {
  getState(): AuthState;
  /** Listener runs on every state change. Pair with `getState` (fits `useSyncExternalStore`). */
  subscribe(listener: (state: AuthState) => void): () => void;
  /** Resolve the stored session. Safe to call again after `restore-failed`. */
  restoreSession(): Promise<void>;
  /** Leave `restore-failed` as a guest. Later restoration results are ignored. */
  continueAsGuest(): void;
  /** Creates the account. `confirmation-required` means a confirmation link was emailed. */
  signUp(credentials: Credentials): Promise<SignUpOutcome>;
  signIn(credentials: Credentials): Promise<void>;
  /** Emails a fresh confirmation link for an unconfirmed account. */
  resendConfirmation(email: string): Promise<void>;
  /** Ends this device's session only; other devices stay signed in. */
  signOut(): Promise<void>;
  /** Stops refresh timers and listeners. The repository is unusable afterwards. */
  dispose(): void;
}

/** The slice of the Supabase auth client the repository relies on (mockable in tests). */
export type AuthClient = Pick<
  SupabaseClient['auth'],
  | 'getSession'
  | 'onAuthStateChange'
  | 'signUp'
  | 'signInWithPassword'
  | 'resend'
  | 'signOut'
  | 'startAutoRefresh'
  | 'stopAutoRefresh'
  | 'exchangeCodeForSession'
  | 'setSession'
>;

/** Platform hook for pausing token refresh in the background; returns a cleanup function. */
export type RegisterLifecycle = (auth: AuthClient) => () => void;

export interface AuthRepositoryOptions {
  /** Native confirmation emails redirect here. Omitted on web so the Site URL is used. */
  emailRedirectTo?: string;
  /** Native `Linking` listener; web is a no-op. */
  registerDeepLink?: RegisterAuthDeepLink;
}

export function createAuthRepository(
  auth: AuthClient,
  registerLifecycle: RegisterLifecycle,
  options: AuthRepositoryOptions = {},
): AuthRepository {
  let state: AuthState = { status: 'restoring' };
  const listeners = new Set<(state: AuthState) => void>();
  // Bumped when the user chooses to continue as guest so an in-flight or late restoration
  // cannot flip them into an account view they did not ask for.
  let restorationGeneration = 0;
  let restoring: { generation: number; promise: Promise<void> } | null = null;
  let guestOverride = false;
  // True while a parsed confirmation callback is exchanging, so a getSession(null)
  // that starts after the parse cannot apply signed-out and flash guest UI.
  let authCallbackInFlight = false;

  function setState(next: AuthState) {
    state = next;
    for (const listener of listeners) listener(state);
  }

  function applySession(session: Session | null) {
    if (session) guestOverride = false;
    setState(
      session ? { status: 'signed-in', user: toAuthUser(session) } : { status: 'signed-out' },
    );
  }

  // Covers sign-ins from `_recoverAndRefresh`, token refreshes, and revoked sessions.
  // `INITIAL_SESSION` is intentionally ignored: `restoreSession` owns startup.
  const { data: authListener } = auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      if (!guestOverride) applySession(null);
      return;
    }
    if (event === 'INITIAL_SESSION' || !session || guestOverride) return;
    if (state.status === 'restoring' || state.status === 'restore-failed') return;
    applySession(session);
  });
  const unregisterLifecycle = registerLifecycle(auth);

  function restoreSession(): Promise<void> {
    if (restoring?.generation === restorationGeneration) return restoring.promise;
    const generation = ++restorationGeneration;
    guestOverride = false;
    setState({ status: 'restoring' });
    const promise = (async () => {
      try {
        const { data, error } = await auth.getSession();
        if (error) throw error;
        if (generation === restorationGeneration && !authCallbackInFlight) {
          applySession(data.session);
        }
      } catch (error) {
        if (generation === restorationGeneration && !authCallbackInFlight) {
          setState({ status: 'restore-failed', error: toAuthFailure(error) });
        }
      } finally {
        if (restoring?.generation === generation) restoring = null;
      }
    })();
    restoring = { generation, promise };
    return promise;
  }

  async function settleAfterFailedCallback(): Promise<void> {
    if (state.status !== 'restoring' && state.status !== 'restore-failed') return;
    if (restoring?.generation === restorationGeneration) {
      await restoring.promise;
    }
    if (state.status !== 'restoring') return;
    if (guestOverride) {
      setState({ status: 'signed-out' });
      return;
    }
    await restoreSession();
  }

  async function applySessionFromUrl(url: string): Promise<boolean> {
    if (!parseAuthCallbackUrl(url)) return false;

    // Invalidate an in-flight restore before the network call so a pending
    // getSession(null) cannot apply signed-out while we exchange.
    restorationGeneration += 1;
    authCallbackInFlight = true;
    if (state.status === 'restore-failed') {
      setState({ status: 'restoring' });
    }

    try {
      const session = await createSessionFromAuthUrl(auth, url);
      if (session) {
        restorationGeneration += 1;
        applySession(session);
        return true;
      }
      authCallbackInFlight = false;
      await settleAfterFailedCallback();
      return false;
    } catch (error) {
      authCallbackInFlight = false;
      await settleAfterFailedCallback();
      throw error;
    } finally {
      authCallbackInFlight = false;
    }
  }

  const unregisterDeepLink =
    options.registerDeepLink?.((url) =>
      applySessionFromUrl(url).catch((error: unknown) => {
        console.error('Failed to apply auth session from deep link', error);
        return false;
      }),
    ) ?? (() => {});

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    restoreSession,

    continueAsGuest() {
      restorationGeneration += 1;
      guestOverride = true;
      setState({ status: 'signed-out' });
    },

    async signUp(input) {
      try {
        const { email, password } = credentialsSchema.parse(input);
        const { data, error } = await auth.signUp({
          email,
          password,
          ...emailRedirectOptions(options.emailRedirectTo),
        });
        if (error) throw error;
        // With confirmations on, Supabase answers an existing email with an obfuscated user
        // that has no identities instead of an error. Telling them to check their inbox would strand them.
        if (data.user?.identities?.length === 0) throw new AuthFailure('email-taken');
        if (data.session) {
          applySession(data.session);
          return 'signed-in';
        }
        return 'confirmation-required';
      } catch (error) {
        throw toAuthFailure(error);
      }
    },

    async signIn(input) {
      try {
        const { email, password } = credentialsSchema.parse(input);
        const { data, error } = await auth.signInWithPassword({ email, password });
        if (error) throw error;
        applySession(data.session);
      } catch (error) {
        throw toAuthFailure(error);
      }
    },

    async resendConfirmation(email) {
      const { error } = await auth.resend({
        type: 'signup',
        email,
        ...emailRedirectOptions(options.emailRedirectTo),
      });
      if (error) throw toAuthFailure(error);
    },

    async signOut() {
      // supabase-js still hits the server for `scope: 'local'` and skips `_removeSession()`
      // on retryable fetch errors. Apply signed-out locally either way so guest tasks stay
      // reachable offline; ignore leftover session events until the next successful sign-in.
      const { error } = await auth.signOut({ scope: 'local' });
      guestOverride = true;
      applySession(null);
      if (error) throw toAuthFailure(error);
    },

    dispose() {
      authListener.subscription.unsubscribe();
      unregisterLifecycle();
      unregisterDeepLink();
      listeners.clear();
    },
  };
}

function emailRedirectOptions(
  emailRedirectTo: string | undefined,
): { options: { emailRedirectTo: string } } | Record<string, never> {
  return emailRedirectTo !== undefined ? { options: { emailRedirectTo } } : {};
}

function toAuthUser(session: Session): AuthUser {
  return { id: session.user.id, email: session.user.email ?? null };
}
