import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { type AuthRepository, MIN_PASSWORD_LENGTH } from '../../data/repositories';
import { ActionButton } from '../components/ActionButton';
import { FormError, FormScreen } from '../components/FormScreen';
import { TextField } from '../components/TextField';
import { useAuthAction } from '../hooks/useAuthAction';
import { colors } from '../theme';

interface SignUpScreenProps {
  auth: AuthRepository;
  /** A confirmation code was emailed; continue with code entry. */
  onVerificationRequired: (email: string) => void;
  onSignIn: () => void;
  onCancel: () => void;
}

export function SignUpScreen({
  auth,
  onVerificationRequired,
  onSignIn,
  onCancel,
}: SignUpScreenProps) {
  // Password lives only in component state and is dropped when this screen unmounts.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { pending, error, run } = useAuthAction();

  const submit = () =>
    run(async () => {
      const outcome = await auth.signUp({ email, password });
      // `signed-in` (confirmations disabled) is handled by the auth state switching screens.
      if (outcome === 'verification-required') onVerificationRequired(email.trim().toLowerCase());
    });
  const canSubmit = !pending && email.trim() !== '' && password.length >= MIN_PASSWORD_LENGTH;

  return (
    <FormScreen
      title="Create account"
      description="We’ll email you a 6-digit code to confirm your address."
    >
      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        autoFocus
        editable={!pending}
        returnKeyType="next"
      />
      <TextField
        label={`Password (at least ${MIN_PASSWORD_LENGTH} characters)`}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        editable={!pending}
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
      />
      {error && (
        <View style={styles.errorBlock}>
          <FormError message={error.message} />
          {error.code === 'email-taken' && (
            <ActionButton label="Sign in instead" color={colors.green} onPress={onSignIn} />
          )}
        </View>
      )}
      <View style={styles.actions}>
        <ActionButton
          label={pending ? 'Creating…' : 'Create account'}
          accent
          disabled={!canSubmit}
          onPress={() => void submit()}
        />
        <ActionButton label="I have an account" disabled={pending} onPress={onSignIn} />
        <ActionButton label="Cancel" color={colors.muted} disabled={pending} onPress={onCancel} />
      </View>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  errorBlock: { gap: 12, alignItems: 'flex-start' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
