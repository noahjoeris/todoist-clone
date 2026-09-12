import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { AuthRepository } from '../../data/repositories';
import { ActionButton } from '../components/ActionButton';
import { FormError, FormScreen } from '../components/FormScreen';
import { TextField } from '../components/TextField';
import { useAuthAction } from '../hooks/useAuthAction';
import { colors } from '../theme';

interface ForgotPasswordScreenProps {
  auth: AuthRepository;
  initialEmail?: string;
  onBack: () => void;
}

export function ForgotPasswordScreen({
  auth,
  initialEmail = '',
  onBack,
}: ForgotPasswordScreenProps) {
  const [email, setEmail] = useState(initialEmail);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { pending, error, run } = useAuthAction();

  const submit = () =>
    run(async () => {
      const normalised = email.trim().toLowerCase();
      await auth.requestPasswordReset(normalised);
      setSentTo(normalised);
    });
  const canSubmit = !pending && email.trim() !== '';

  if (sentTo !== null) {
    return (
      <FormScreen
        title="Check your email"
        description={`We sent a reset link to ${sentTo}. Open it to choose a new password.`}
      >
        {error && <FormError message={error.message} />}
        {!error && <Text style={styles.notice}>Reset link sent.</Text>}
        <View style={styles.actions}>
          <ActionButton label="Back to sign in" accent disabled={pending} onPress={onBack} />
          <ActionButton
            label={pending ? 'Sending…' : 'Resend link'}
            disabled={pending}
            onPress={() => void submit()}
          />
        </View>
      </FormScreen>
    );
  }

  return (
    <FormScreen
      title="Forgot password"
      description="We’ll email you a link to choose a new password."
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
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
      />
      {error && <FormError message={error.message} />}
      <View style={styles.actions}>
        <ActionButton
          label={pending ? 'Sending…' : 'Send reset link'}
          accent
          disabled={!canSubmit}
          onPress={() => void submit()}
        />
        <ActionButton label="Back" color={colors.muted} disabled={pending} onPress={onBack} />
      </View>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  notice: { color: colors.green, fontSize: 14 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
