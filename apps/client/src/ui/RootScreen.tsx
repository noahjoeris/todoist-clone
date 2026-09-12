import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  type AuthFailure,
  type AuthRepository,
  type GuestTaskAdoptionRepository,
  type LabelRepositories,
  type ProjectRepositories,
  type RecentSearchRepositories,
  type RecentSearchRepository,
  type SyncStatusSource,
  type TaskRepositories,
  type TaskRepository,
  UPCOMING_PAGE_DAYS,
} from '../data/repositories';
import type { DataSystem } from '../data/system';
import type { AccountEntry } from './account-entry';
import { canWriteAccountTasks } from './account-write-ready';
import { GuestTaskAdoptionBanner } from './components/GuestTaskAdoptionBanner';
import type { HomePane } from './home-pane';
import { useAuthState } from './hooks/useAuthState';
import { AccountScreen } from './screens/AccountScreen';
import { ChangeEmailScreen } from './screens/ChangeEmailScreen';
import { ConfirmEmailScreen } from './screens/ConfirmEmailScreen';
import { ForgotPasswordScreen } from './screens/ForgotPasswordScreen';
import { HomeScreen } from './screens/HomeScreen';
import {
  PreparingAccountScreen,
  SessionRestoreFailedScreen,
  SessionRestoringScreen,
} from './screens/SessionRestoreScreen';
import { SignInScreen } from './screens/SignInScreen';
import { SignUpScreen } from './screens/SignUpScreen';
import { UpdatePasswordScreen } from './screens/UpdatePasswordScreen';

/**
 * Chooses between guest and account content. Without cloud configuration the app is
 * guest-only; otherwise nothing renders until the stored session is resolved.
 */
export function RootScreen({ system }: { system: DataSystem }) {
  switch (system.auth.status) {
    case 'unconfigured':
      return (
        <GuestHome
          repository={system.tasks.guest}
          recents={system.searchRecents.guest}
          account={{ kind: 'hidden' }}
        />
      );
    case 'misconfigured':
      return (
        <GuestHome
          repository={system.tasks.guest}
          recents={system.searchRecents.guest}
          account={{ kind: 'unavailable', message: system.auth.error.message }}
        />
      );
    case 'available': {
      const sync = system.sync;
      if (sync == null) {
        throw new Error('Cloud auth is available without a sync status source');
      }
      return (
        <AccountAwareScreen
          tasks={system.tasks}
          labels={system.labels}
          projects={system.projects}
          searchRecents={system.searchRecents}
          auth={system.auth.repository}
          sync={sync}
          guestTaskAdoption={system.guestTaskAdoption}
        />
      );
    }
  }
}

type AuthScreen =
  | { name: 'sign-in'; error?: AuthFailure }
  | { name: 'sign-up' }
  | { name: 'confirm'; email: string }
  | { name: 'forgot-password'; email: string }
  | { name: 'account' }
  | { name: 'change-email' }
  | { name: 'change-password' };

function AccountAwareScreen({
  tasks,
  labels,
  projects,
  searchRecents,
  auth,
  sync,
  guestTaskAdoption,
}: {
  tasks: TaskRepositories;
  labels: LabelRepositories;
  projects: ProjectRepositories;
  searchRecents: RecentSearchRepositories;
  auth: AuthRepository;
  sync: SyncStatusSource;
  guestTaskAdoption: GuestTaskAdoptionRepository;
}) {
  const authState = useAuthState(auth);
  const [screen, setScreen] = useState<AuthScreen | null>(null);
  const [pane, setPane] = useState<HomePane>({ type: 'inbox' });
  const [upcomingDays, setUpcomingDays] = useState(UPCOMING_PAGE_DAYS);
  const signedInUserId = authState.status === 'signed-in' ? authState.user.id : null;
  const identityKey = signedInUserId ?? 'guest';
  const localDataReady = useAccountLocalDataReady(sync, signedInUserId);
  const userTasks = useMemo(
    () => (signedInUserId == null ? null : tasks.forUser(signedInUserId)),
    [tasks, signedInUserId],
  );
  const userLabels = useMemo(
    () => (signedInUserId == null ? null : labels.forUser(signedInUserId)),
    [labels, signedInUserId],
  );
  const userProjects = useMemo(
    () => (signedInUserId == null ? null : projects.forUser(signedInUserId)),
    [projects, signedInUserId],
  );

  useEffect(() => {
    void identityKey;
    setPane({ type: 'inbox' });
    setUpcomingDays(UPCOMING_PAGE_DAYS);
  }, [identityKey]);

  // Successful sign-in returns to the account task list; sign-out leaves the account sub-screen.
  // An expired confirmation redirect is signed-out with `redirectError` — open Sign in once.
  useEffect(() => {
    if (authState.status === 'signed-in') {
      setScreen(null);
      return;
    }
    if (authState.status !== 'signed-out') return;
    const state = auth.getState();
    setScreen(
      state.status === 'signed-out' && state.redirectError
        ? { name: 'sign-in', error: state.redirectError }
        : null,
    );
  }, [auth, authState.status]);

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
      if (authState.passwordRecovery) {
        return <UpdatePasswordScreen auth={auth} mode="recovery" />;
      }
      if (userTasks == null) return null;
      if (!localDataReady) return <PreparingAccountScreen />;
      if (screen?.name === 'account') {
        return (
          <AccountScreen
            auth={auth}
            user={authState.user}
            onChangeEmail={() => setScreen({ name: 'change-email' })}
            onChangePassword={() => setScreen({ name: 'change-password' })}
            onBack={() => setScreen(null)}
            sync={sync}
          />
        );
      }
      if (screen?.name === 'change-email') {
        return (
          <ChangeEmailScreen
            auth={auth}
            currentEmail={authState.user.email}
            onBack={() => setScreen({ name: 'account' })}
          />
        );
      }
      if (screen?.name === 'change-password') {
        return (
          <UpdatePasswordScreen
            auth={auth}
            mode="change"
            onBack={() => setScreen({ name: 'account' })}
          />
        );
      }
      return (
        <HomeScreen
          key={identityKey}
          repository={userTasks}
          recents={searchRecents.forUser(authState.user.id)}
          pane={pane}
          onPaneChange={setPane}
          upcomingDays={upcomingDays}
          onLoadMoreUpcoming={() => setUpcomingDays((days) => days + UPCOMING_PAGE_DAYS)}
          banner={
            <GuestTaskAdoptionBanner repository={guestTaskAdoption} userId={authState.user.id} />
          }
          account={{
            kind: 'account',
            label: authState.user.email ?? 'Account',
            onPress: () => setScreen({ name: 'account' }),
          }}
          sync={sync}
          {...(userLabels ? { labels: userLabels } : {})}
          {...(userProjects ? { projects: userProjects } : {})}
        />
      );
    case 'signed-out':
      break;
  }

  switch (screen?.name) {
    case undefined:
      return (
        <HomeScreen
          key={identityKey}
          repository={tasks.guest}
          recents={searchRecents.guest}
          pane={pane}
          onPaneChange={setPane}
          upcomingDays={upcomingDays}
          onLoadMoreUpcoming={() => setUpcomingDays((days) => days + UPCOMING_PAGE_DAYS)}
          account={{ kind: 'sign-in', onPress: () => setScreen({ name: 'sign-in' }) }}
        />
      );
    case 'sign-in':
      return (
        <SignInScreen
          auth={auth}
          onCreateAccount={() => setScreen({ name: 'sign-up' })}
          onConfirmEmail={(email) => setScreen({ name: 'confirm', email })}
          onForgotPassword={(email) => setScreen({ name: 'forgot-password', email })}
          onCancel={() => setScreen(null)}
          {...(screen.error ? { initialError: screen.error } : {})}
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
    case 'forgot-password':
      return (
        <ForgotPasswordScreen
          auth={auth}
          {...(screen.email !== '' ? { initialEmail: screen.email } : {})}
          onBack={() => setScreen({ name: 'sign-in' })}
        />
      );
    case 'account':
    case 'change-email':
    case 'change-password':
      return (
        <HomeScreen
          key={identityKey}
          repository={tasks.guest}
          recents={searchRecents.guest}
          pane={pane}
          onPaneChange={setPane}
          upcomingDays={upcomingDays}
          onLoadMoreUpcoming={() => setUpcomingDays((days) => days + UPCOMING_PAGE_DAYS)}
          account={{ kind: 'sign-in', onPress: () => setScreen({ name: 'sign-in' }) }}
        />
      );
  }
}

function GuestHome({
  repository,
  recents,
  account,
}: {
  repository: TaskRepository;
  recents: RecentSearchRepository;
  account: AccountEntry;
}) {
  const [pane, setPane] = useState<HomePane>({ type: 'inbox' });
  const [upcomingDays, setUpcomingDays] = useState(UPCOMING_PAGE_DAYS);
  return (
    <HomeScreen
      repository={repository}
      recents={recents}
      account={account}
      pane={pane}
      onPaneChange={setPane}
      upcomingDays={upcomingDays}
      onLoadMoreUpcoming={() => setUpcomingDays((days) => days + UPCOMING_PAGE_DAYS)}
    />
  );
}

/** True only for the signed-in account whose ownership check/clear has finished. */
function useAccountLocalDataReady(sync: SyncStatusSource, userId: string | null): boolean {
  return useSyncExternalStore(
    sync.subscribe,
    () => canWriteAccountTasks(userId, sync),
    () => canWriteAccountTasks(userId, sync),
  );
}
