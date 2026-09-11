import { useEffect, useMemo, useState } from 'react';
import type { AuthRepository, TaskRepositories } from '../data/repositories';
import type { SyncStatusSource } from '../data/sync/sync-lifecycle';
import type { DataSystem } from '../data/system';
import { useAuthState } from './hooks/useAuthState';
import { AccountScreen } from './screens/AccountScreen';
import { ConfirmEmailScreen } from './screens/ConfirmEmailScreen';
import { HomeScreen } from './screens/HomeScreen';
import { SessionRestoreFailedScreen, SessionRestoringScreen } from './screens/SessionRestoreScreen';
import { SignInScreen } from './screens/SignInScreen';
import { SignUpScreen } from './screens/SignUpScreen';

/**
 * Chooses between guest and account content. Without cloud configuration the app is
 * guest-only; otherwise nothing renders until the stored session is resolved.
 */
export function RootScreen({ system }: { system: DataSystem }) {
  switch (system.auth.status) {
    case 'unconfigured':
      return <HomeScreen repository={system.tasks.guest} account={{ kind: 'hidden' }} />;
    case 'misconfigured':
      return (
        <HomeScreen
          repository={system.tasks.guest}
          account={{ kind: 'unavailable', message: system.auth.error.message }}
        />
      );
    case 'available': {
      const sync = system.sync;
      if (sync == null) {
        throw new Error('Cloud auth is available without a sync status source');
      }
      return <AccountAwareScreen tasks={system.tasks} auth={system.auth.repository} sync={sync} />;
    }
  }
}

type AuthScreen =
  | { name: 'sign-in' }
  | { name: 'sign-up' }
  | { name: 'confirm'; email: string }
  | { name: 'account' };

function AccountAwareScreen({
  tasks,
  auth,
  sync,
}: {
  tasks: TaskRepositories;
  auth: AuthRepository;
  sync: SyncStatusSource;
}) {
  const authState = useAuthState(auth);
  const [screen, setScreen] = useState<AuthScreen | null>(null);
  const signedInUserId = authState.status === 'signed-in' ? authState.user.id : null;
  const userTasks = useMemo(
    () => (signedInUserId == null ? null : tasks.forUser(signedInUserId)),
    [tasks, signedInUserId],
  );

  // Successful sign-in returns to the account task list; sign-out leaves the account sub-screen.
  useEffect(() => {
    if (authState.status === 'signed-in' || authState.status === 'signed-out') setScreen(null);
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
      if (userTasks == null) return null;
      if (screen?.name === 'account') {
        return (
          <AccountScreen
            auth={auth}
            user={authState.user}
            onBack={() => setScreen(null)}
            sync={sync}
          />
        );
      }
      return (
        <HomeScreen
          repository={userTasks}
          account={{
            kind: 'account',
            label: authState.user.email ?? 'Account',
            onPress: () => setScreen({ name: 'account' }),
          }}
          sync={sync}
        />
      );
    case 'signed-out':
      break;
  }

  switch (screen?.name) {
    case undefined:
      return (
        <HomeScreen
          repository={tasks.guest}
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
    case 'account':
      return (
        <HomeScreen
          repository={tasks.guest}
          account={{ kind: 'sign-in', onPress: () => setScreen({ name: 'sign-in' }) }}
        />
      );
  }
}
