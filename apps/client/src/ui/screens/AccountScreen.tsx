import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { AuthRepository, AuthUser } from '../../data/repositories';
import type { SyncStatusSource } from '../../data/sync/sync-lifecycle';
import { ActionButton } from '../components/ActionButton';
import { FormError, FormScreen } from '../components/FormScreen';
import { useAuthAction } from '../hooks/useAuthAction';
import { colors } from '../theme';

interface AccountScreenProps {
  auth: AuthRepository;
  user: AuthUser;
  onBack: () => void;
  sync: SyncStatusSource;
}

/**
 * Account settings while signed in. Guest tasks stay in the local-only table and
 * reappear after sign-out (see ADR-011 / ADR-012). Sign-out is blocked while uploads
 * are queued so `disconnectAndClear` cannot discard unsynced account edits.
 */
export function AccountScreen({ auth, user, onBack, sync }: AccountScreenProps) {
  const { pending, error, run } = useAuthAction();
  const queueCount = useUploadQueueCount(sync);
  const waiting = queueCount > 0;
  const waitingLabel = `Waiting for ${queueCount} ${queueCount === 1 ? 'change' : 'changes'} to sync…`;

  return (
    <FormScreen title="Your account">
      <View style={styles.card}>
        <Text style={styles.label}>Signed in as</Text>
        <Text style={styles.email}>{user.email ?? user.id}</Text>
      </View>
      <Text style={styles.note}>
        The tasks you created as a guest stay on this device and come back when you sign out.
      </Text>
      {error && <FormError message={error.message} />}
      <View style={styles.actions}>
        <ActionButton
          label={pending ? 'Signing out…' : waiting ? waitingLabel : 'Sign out'}
          disabled={pending || waiting}
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

function useUploadQueueCount(sync: SyncStatusSource): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      const stats = await sync.getUploadQueueStats();
      if (!cancelled) setCount(stats.count);
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

  return count;
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
