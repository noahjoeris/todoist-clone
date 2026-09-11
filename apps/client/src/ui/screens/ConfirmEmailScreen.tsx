import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { AuthRepository } from '../../data/repositories';
import { ActionButton } from '../components/ActionButton';
import { FormError, FormScreen } from '../components/FormScreen';
import { useAuthAction } from '../hooks/useAuthAction';
import { colors } from '../theme';

interface ConfirmEmailScreenProps {
  auth: AuthRepository;
  email: string;
  onSignIn: () => void;
}

/**
 * Shown after sign-up (or after signing in with an unconfirmed email). Confirmation happens
 * through the link in the email: web consumes the Site URL fragment; native opens
 * `todoist-clone://auth/callback` and signs the user in. Sign-in remains as a fallback.
 */
export function ConfirmEmailScreen({ auth, email, onSignIn }: ConfirmEmailScreenProps) {
  const [resent, setResent] = useState(false);
  const { pending, error, run } = useAuthAction();

  const resend = () =>
    run(async () => {
      setResent(false);
      await auth.resendConfirmation(email);
      setResent(true);
    });

  return (
    <FormScreen
      title="Check your email"
      description={`We sent a confirmation link to ${email}. Open it to activate your account.`}
    >
      {error && <FormError message={error.message} />}
      {resent && !error && <Text style={styles.notice}>New link sent.</Text>}
      <View style={styles.actions}>
        <ActionButton label="Sign in" accent disabled={pending} onPress={onSignIn} />
        <ActionButton
          label={pending ? 'Sending…' : 'Resend link'}
          disabled={pending}
          onPress={() => void resend()}
        />
      </View>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  notice: { color: colors.green, fontSize: 14 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
