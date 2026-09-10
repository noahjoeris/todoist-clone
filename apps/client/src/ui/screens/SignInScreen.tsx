import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { AuthRepository } from '../../data/repositories';
import { ActionButton } from '../components/ActionButton';
import { FormError, FormScreen } from '../components/FormScreen';
import { TextField } from '../components/TextField';
import { useAuthAction } from '../hooks/useAuthAction';
import { colors } from '../theme';

interface SignInScreenProps {
  auth: AuthRepository;
  onCreateAccount: () => void;
  /** The account exists but its email is unconfirmed; show the confirmation instructions. */
  onConfirmEmail: (email: string) => void;
  onCancel: () => void;
}

export function SignInScreen({
  auth,
  onCreateAccount,
  onConfirmEmail,
  onCancel,
}: SignInScreenProps) {
  // Password lives only in component state and is dropped when this screen unmounts.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { pending, error, run } = useAuthAction();

  const submit = () => run(() => auth.signIn({ email, password }));
  const canSubmit = !pending && email.trim() !== '' && password !== '';

  return (
    <FormScreen title="Sign in" description="Your guest tasks stay on this device.">
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
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        editable={!pending}
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
      />
      {error && (
        <View style={styles.errorBlock}>
          <FormError message={error.message} />
          {error.code === 'email-not-confirmed' && (
            <ActionButton
              label="Resend confirmation link"
              color={colors.green}
              onPress={() => onConfirmEmail(email.trim().toLowerCase())}
            />
          )}
        </View>
      )}
      <View style={styles.actions}>
        <ActionButton
          label={pending ? 'Signing in…' : 'Sign in'}
          accent
          disabled={!canSubmit}
          onPress={() => void submit()}
        />
        <ActionButton label="Create account" disabled={pending} onPress={onCreateAccount} />
        <ActionButton label="Cancel" color={colors.muted} disabled={pending} onPress={onCancel} />
      </View>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  errorBlock: { gap: 12, alignItems: 'flex-start' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
