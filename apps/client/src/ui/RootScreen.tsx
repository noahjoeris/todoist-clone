import { useEffect, useState } from 'react';
import type { AuthRepository, TaskRepository } from '../data/repositories';
import type { DataSystem } from '../data/system';
import { useAuthState } from './hooks/useAuthState';
import { AccountScreen } from './screens/AccountScreen';
import { ConfirmEmailScreen } from './screens/ConfirmEmailScreen';
import { HomeScreen } from './screens/HomeScreen';
import { SessionRestoreFailedScreen, SessionRestoringScreen } from './screens/SessionRestoreScreen';
import { SignInScreen } from './screens/SignInScreen';
import { SignUpScreen } from './screens/SignUpScreen';

/**
 * Chooses between guest and account content. Without Supabase configuration the app is
 * guest-only; otherwise nothing renders until the stored session is resolved.
 */
export function RootScreen({ system }: { system: DataSystem }) {
  switch (system.auth.status) {
    case 'unconfigured':
      return <HomeScreen repository={system.tasks} account={{ kind: 'hidden' }} />;
    case 'misconfigured':
      return (
        <HomeScreen
          repository={system.tasks}
          account={{ kind: 'unavailable', message: system.auth.error.message }}
        />
      );
    case 'available':
      return <AccountAwareScreen tasks={system.tasks} auth={system.auth.repository} />;
  }
}

type AuthScreen = { name: 'sign-in' } | { name: 'sign-up' } | { name: 'confirm'; email: string };

function AccountAwareScreen({ tasks, auth }: { tasks: TaskRepository; auth: AuthRepository }) {
  const authState = useAuthState(auth);
  const [screen, setScreen] = useState<AuthScreen | null>(null);

  // Any successful sign-in (from whichever screen) returns to the account view.
  useEffect(() => {
    if (authState.status === 'signed-in') setScreen(null);
  }, [authState.status]);

  switch (authState.status) {
    case 'restoring':
      return <SessionRestoringScreen />;
    case 'restore-failed':
      return (
        <SessionRestoreFailedScreen
          error={authState.error}
          onRetry={() => void auth.restoreSession()}
          onContinueAsGuest={() => auth.continueAsGuest()}
        />
      );
    case 'signed-in':
      // Guest list and composer are unmounted here; their rows stay untouched in `local_tasks`.
      return <AccountScreen auth={auth} user={authState.user} />;
    case 'signed-out':
      break;
  }

  switch (screen?.name) {
    case undefined:
      return (
        <HomeScreen
          repository={tasks}
          account={{ kind: 'sign-in', onPress: () => setScreen({ name: 'sign-in' }) }}
        />
      );
    case 'sign-in':
      return (
        <SignInScreen
          auth={auth}
          onCreateAccount={() => setScreen({ name: 'sign-up' })}
          onConfirmEmail={(email) => setScreen({ name: 'confirm', email })}
          onCancel={() => setScreen(null)}
        />
      );
    case 'sign-up':
      return (
        <SignUpScreen
          auth={auth}
          onConfirmationRequired={(email) => setScreen({ name: 'confirm', email })}
          onSignIn={() => setScreen({ name: 'sign-in' })}
          onCancel={() => setScreen(null)}
        />
      );
    case 'confirm':
      return (
        <ConfirmEmailScreen
          auth={auth}
          email={screen.email}
          onSignIn={() => setScreen({ name: 'sign-in' })}
        />
      );
  }
}
