import { ActivityIndicator, StyleSheet, View } from 'react-native';
import type { AuthFailure } from '../../data/repositories';
import { ActionButton } from '../components/ActionButton';
import { FormError, FormScreen } from '../components/FormScreen';
import { colors } from '../theme';

/** Shown while the stored session is resolved, so guest tasks never flash before an account. */
export function SessionRestoringScreen() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator accessibilityLabel="Restoring your session" color={colors.muted} />
    </View>
  );
}

interface SessionRestoreFailedScreenProps {
  error: AuthFailure;
  onRetry: () => void;
  onContinueAsGuest: () => void;
}

export function SessionRestoreFailedScreen({
  error,
  onRetry,
  onContinueAsGuest,
}: SessionRestoreFailedScreenProps) {
  return (
    <FormScreen
      title="Couldn’t restore your session"
      description="Your tasks are safe on this device. Try again, or continue as a guest for now."
    >
      <FormError message={error.message} />
      <View style={styles.actions}>
        <ActionButton label="Retry" accent onPress={onRetry} />
        <ActionButton label="Continue as guest" onPress={onContinueAsGuest} />
      </View>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
