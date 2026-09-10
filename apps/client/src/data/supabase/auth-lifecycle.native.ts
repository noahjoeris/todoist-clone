import { AppState, type AppStateStatus } from 'react-native';
import type { RegisterAuthLifecycle } from './auth-lifecycle';

// Without a browser `visibilitychange` event, supabase-js cannot tell when the app is in the
// background. Follow https://supabase.com/docs/guides/auth/quickstarts/react-native: refresh
// only while active so background timers do not fire and tokens refresh promptly on return.
export const registerAuthLifecycle: RegisterAuthLifecycle = (auth) => {
  const apply = (state: AppStateStatus) => {
    void (state === 'active' ? auth.startAutoRefresh() : auth.stopAutoRefresh());
  };
  apply(AppState.currentState);
  const subscription = AppState.addEventListener('change', apply);
  return () => subscription.remove();
};
