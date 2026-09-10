import { useEffect, useSyncExternalStore } from 'react';
import type { AuthRepository, AuthState } from '../../data/repositories';

/** Subscribes to the repository's auth state and kicks off session restoration on mount. */
export function useAuthState(auth: AuthRepository): AuthState {
  const state = useSyncExternalStore(auth.subscribe, auth.getState, auth.getState);

  useEffect(() => {
    // `restoreSession` dedupes concurrent calls, so a remount while restoring is harmless.
    void auth.restoreSession();
  }, [auth]);

  return state;
}
