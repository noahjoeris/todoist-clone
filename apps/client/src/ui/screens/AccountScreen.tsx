import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { AuthRepository, AuthUser, SyncStatusSource } from '../../data/repositories';
import { ActionButton } from '../components/ActionButton';
import { FormError, FormScreen } from '../components/FormScreen';
import { useAuthAction } from '../hooks/useAuthAction';
import { colors } from '../theme';
import { signOutAvailability, type UploadQueueCount } from './account-sign-out';

interface AccountScreenProps {
  auth: AuthRepository;
  user: AuthUser;
  onChangeEmail: () => void;
  onChangePassword: () => void;
  onBack: () => void;
  sync: SyncStatusSource;
}

/**
 * Account settings while signed in. Guest tasks stay in the local-only table unless
 * adopted into this account (ADR-016) and reappear after sign-out (ADR-011 / ADR-012).
 * Sign-out is blocked until the upload-queue size is known, and while uploads are
 * queued, so `disconnectAndClear` cannot discard unsynced account edits.
 */
export function AccountScreen({
  auth,
  user,
  onChangeEmail,
  onChangePassword,
  onBack,
  sync,
}: AccountScreenProps) {
  const { pending, error, run } = useAuthAction();
  const availability = signOutAvailability(useUploadQueueCount(sync));
  const waiting = availability.action === 'wait';
  const checking = availability.action === 'checking';
  const signOutLabel = pending
    ? 'Signing out…'
    : availability.action === 'wait'
      ? `Waiting for ${availability.count} ${availability.count === 1 ? 'change' : 'changes'} to sync…`
      : availability.action === 'checking'
        ? 'Checking sync…'
        : 'Sign out';

  return (
    <FormScreen title="Your account">
      <View style={styles.card}>
        <Text style={styles.label}>Signed in as</Text>
        <Text style={styles.email}>{user.email ?? user.id}</Text>
      </View>
      <Text style={styles.note}>
        Guest tasks stay on this device unless you add them to this account.
      </Text>
      {error && <FormError message={error.message} />}
      <View style={styles.actions}>
        <ActionButton label="Change email" disabled={pending} onPress={onChangeEmail} />
        <ActionButton label="Change password" disabled={pending} onPress={onChangePassword} />
        <ActionButton
          label={signOutLabel}
          disabled={pending || waiting || checking}
          onPress={() => void run(() => auth.signOut())}
        />
        {waiting && (
          <ActionButton
            label="Sign out and discard"
            color={colors.error}
            disabled={pending}
            onPress={() => void run(() => auth.signOut())}
          />
        )}
        <ActionButton label="Back" color={colors.muted} disabled={pending} onPress={onBack} />
      </View>
    </FormScreen>
  );
}

function useUploadQueueCount(sync: SyncStatusSource): UploadQueueCount {
  const [queue, setQueue] = useState<UploadQueueCount>({ status: 'unknown' });

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const stats = await sync.getUploadQueueStats();
        if (!cancelled) setQueue({ status: 'ready', count: stats.count });
      } catch {
        if (!cancelled) setQueue({ status: 'unknown' });
      }
    }

    void refresh();
    const unsubscribe = sync.subscribe(() => {
      void refresh();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [sync]);

  return queue;
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
    padding: 16,
    gap: 4,
  },
  label: { color: colors.muted, fontSize: 13 },
  email: { color: colors.text, fontSize: 17, fontWeight: '600' },
  note: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
