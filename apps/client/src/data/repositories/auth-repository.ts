import type { Session, SupabaseClient } from '@supabase/supabase-js';
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
>;

/** Platform hook for pausing token refresh in the background; returns a cleanup function. */
export type RegisterLifecycle = (auth: AuthClient) => () => void;

export function createAuthRepository(
  auth: AuthClient,
  registerLifecycle: RegisterLifecycle,
): AuthRepository {
  let state: AuthState = { status: 'restoring' };
  const listeners = new Set<(state: AuthState) => void>();
  // Bumped when the user chooses to continue as guest so an in-flight or late restoration
  // cannot flip them into an account view they did not ask for.
  let restorationGeneration = 0;
  let restoring: { generation: number; promise: Promise<void> } | null = null;
  let guestOverride = false;

  function setState(next: AuthState) {
    state = next;
    for (const listener of listeners) listener(state);
  }

  function applySession(session: Session | null) {
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

  function clearGuestOverride() {
    guestOverride = false;
  }

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    restoreSession() {
      if (restoring?.generation === restorationGeneration) return restoring.promise;
      const generation = ++restorationGeneration;
      clearGuestOverride();
      setState({ status: 'restoring' });
      const promise = (async () => {
        try {
          const { data, error } = await auth.getSession();
          if (error) throw error;
          if (generation === restorationGeneration) applySession(data.session);
        } catch (error) {
          if (generation === restorationGeneration) {
            setState({ status: 'restore-failed', error: toAuthFailure(error) });
          }
        } finally {
          if (restoring?.generation === generation) restoring = null;
        }
      })();
      restoring = { generation, promise };
      return promise;
    },

    continueAsGuest() {
      restorationGeneration += 1;
      guestOverride = true;
      setState({ status: 'signed-out' });
    },

    async signUp(input) {
      clearGuestOverride();
      try {
        const { email, password } = credentialsSchema.parse(input);
        const { data, error } = await auth.signUp({ email, password });
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
      clearGuestOverride();
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
      const { error } = await auth.resend({ type: 'signup', email });
      if (error) throw toAuthFailure(error);
    },

    async signOut() {
      const { error } = await auth.signOut({ scope: 'local' });
      if (error) throw toAuthFailure(error);
      applySession(null);
    },

    dispose() {
      authListener.subscription.unsubscribe();
      unregisterLifecycle();
      listeners.clear();
    },
  };
}

function toAuthUser(session: Session): AuthUser {
  return { id: session.user.id, email: session.user.email ?? null };
}
