import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import { createSessionFromAuthUrl, parseAuthCallbackUrl } from '../supabase/auth-callback';
import type { RegisterAuthDeepLink } from '../supabase/auth-deep-link';
import {
  AuthFailure,
  type AuthState,
  type AuthUser,
  type Credentials,
  credentialsSchema,
  emailSchema,
  passwordSchema,
  toAuthFailure,
} from './auth';
import { type AuthUrlError, parseAuthUrlType } from './auth-url';

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
  /** Emails a password-recovery link. The account is not enumerated on success. */
  requestPasswordReset(email: string): Promise<void>;
  /** Sets a new password (recovery session or signed-in change). */
  updatePassword(password: string): Promise<void>;
  /** Starts an email change; the new address must be confirmed from the emailed link. */
  updateEmail(email: string): Promise<void>;
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
  | 'resetPasswordForEmail'
  | 'updateUser'
  | 'signOut'
  | 'startAutoRefresh'
  | 'stopAutoRefresh'
  | 'exchangeCodeForSession'
  | 'setSession'
>;

/** Platform hook for pausing token refresh in the background; returns a cleanup function. */
export type RegisterLifecycle = (auth: AuthClient) => () => void;

export interface AuthRepositoryOptions {
  /**
   * Native confirmation, recovery, and email-change emails redirect here. Omitted on web so
   * the Site URL is used.
   */
  emailRedirectTo?: string;
  /** Native `Linking` listener; web is a no-op. */
  registerDeepLink?: RegisterAuthDeepLink;
  /**
   * Auth error captured from the page URL before supabase-js consumes it (web confirmation
   * / recovery redirects). Native omits this; deep-link errors go through the callback exchange.
   */
  urlAuthError?: AuthUrlError | null;
  /**
   * True when the page URL is a recovery redirect (`type=recovery`). Combined with
   * `PASSWORD_RECOVERY` so the signed-in state asks for a new password.
   */
  passwordRecoveryFromUrl?: boolean;
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
  let pendingPasswordRecovery = options.passwordRecoveryFromUrl === true;

  function setState(next: AuthState) {
    state = next;
    for (const listener of listeners) listener(state);
  }

  function applySession(session: Session | null, extras?: { passwordRecovery?: true }) {
    if (session) {
      guestOverride = false;
      const passwordRecovery =
        extras?.passwordRecovery === true ||
        pendingPasswordRecovery ||
        (state.status === 'signed-in' && state.passwordRecovery === true);
      setState(
        passwordRecovery
          ? { status: 'signed-in', user: toAuthUser(session), passwordRecovery: true }
          : { status: 'signed-in', user: toAuthUser(session) },
      );
      return;
    }
    pendingPasswordRecovery = false;
    // A no-session event after restore already published `signed-out` must not drop
    // `redirectError`. Real sign-out is `signed-in` → `signed-out`.
    if (state.status === 'signed-out') return;
    setState({ status: 'signed-out' });
  }

  function signedInUser(user: User | AuthUser): AuthUser {
    return { id: user.id, email: user.email ?? null };
  }

  function clearPasswordRecovery(user?: User | null) {
    pendingPasswordRecovery = false;
    if (state.status !== 'signed-in') return;
    setState({ status: 'signed-in', user: user ? signedInUser(user) : state.user });
  }

  // Covers sign-ins from `_recoverAndRefresh`, token refreshes, and revoked sessions.
  // Startup (`INITIAL_SESSION`, and `SIGNED_OUT` while restoring / restore-failed) is
  // ignored: `restoreSession` owns the first terminal state, including `redirectError`.
  const { data: authListener } = auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      pendingPasswordRecovery = true;
      if (guestOverride) return;
      if (state.status === 'restoring' || state.status === 'restore-failed') return;
      if (session) applySession(session, { passwordRecovery: true });
      return;
    }
    if (event === 'INITIAL_SESSION' || guestOverride) return;
    if (state.status === 'restoring' || state.status === 'restore-failed') return;
    if (event === 'SIGNED_OUT') {
      applySession(null);
      return;
    }
    if (!session) return;
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
        if (generation !== restorationGeneration || authCallbackInFlight) return;
        if (data.session) {
          applySession(
            data.session,
            pendingPasswordRecovery ? { passwordRecovery: true } : undefined,
          );
          return;
        }
        pendingPasswordRecovery = false;
        const redirectError = options.urlAuthError
          ? toAuthFailure(options.urlAuthError)
          : undefined;
        setState(
          redirectError ? { status: 'signed-out', redirectError } : { status: 'signed-out' },
        );
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
    if (parseAuthUrlType(url) === 'recovery') {
      pendingPasswordRecovery = true;
    }
    if (state.status === 'restore-failed') {
      setState({ status: 'restoring' });
    }

    try {
      const session = await createSessionFromAuthUrl(auth, url);
      if (session) {
        restorationGeneration += 1;
        applySession(session, pendingPasswordRecovery ? { passwordRecovery: true } : undefined);
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
      pendingPasswordRecovery = false;
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

    async requestPasswordReset(email) {
      try {
        const parsed = emailSchema.parse(email);
        const { error } = await auth.resetPasswordForEmail(
          parsed,
          emailRedirectToOptions(options.emailRedirectTo),
        );
        if (error) throw error;
      } catch (error) {
        throw toAuthFailure(error);
      }
    },

    async updatePassword(password) {
      try {
        const parsed = passwordSchema.parse(password);
        const { data, error } = await auth.updateUser({ password: parsed });
        if (error) throw error;
        clearPasswordRecovery(data.user);
      } catch (error) {
        throw toAuthFailure(error);
      }
    },

    async updateEmail(email) {
      try {
        const parsed = emailSchema.parse(email);
        if (state.status === 'signed-in' && state.user.email === parsed) {
          throw new AuthFailure('invalid-input', 'Enter a different email address.');
        }
        const { error } = await auth.updateUser(
          { email: parsed },
          options.emailRedirectTo ? { emailRedirectTo: options.emailRedirectTo } : undefined,
        );
        if (error) throw error;
      } catch (error) {
        throw toAuthFailure(error);
      }
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

function emailRedirectToOptions(
  emailRedirectTo: string | undefined,
): { redirectTo: string } | Record<string, never> {
  return emailRedirectTo !== undefined ? { redirectTo: emailRedirectTo } : {};
}

function toAuthUser(session: Session): AuthUser {
  return { id: session.user.id, email: session.user.email ?? null };
}
