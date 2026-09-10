import { StyleSheet, Text, View } from 'react-native';
import type { AuthRepository, AuthUser } from '../../data/repositories';
import { ActionButton } from '../components/ActionButton';
import { FormError, FormScreen } from '../components/FormScreen';
import { useAuthAction } from '../hooks/useAuthAction';
import { colors } from '../theme';

interface AccountScreenProps {
  auth: AuthRepository;
  user: AuthUser;
}

/**
 * Placeholder shown while signed in. Guest tasks are hidden, not touched: they stay in the
 * local-only table and reappear after sign-out (see ADR-011 / ADR-012).
 */
export function AccountScreen({ auth, user }: AccountScreenProps) {
  const { pending, error, run } = useAuthAction();

  return (
    <FormScreen title="Your account" description="Account tasks are coming with sync.">
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
          label={pending ? 'Signing out…' : 'Sign out'}
          disabled={pending}
          onPress={() => void run(() => auth.signOut())}
        />
      </View>
    </FormScreen>
  );
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
  actions: { flexDirection: 'row', gap: 8 },
});
