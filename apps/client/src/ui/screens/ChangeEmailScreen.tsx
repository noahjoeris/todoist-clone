import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { AuthRepository } from '../../data/repositories';
import { ActionButton } from '../components/ActionButton';
import { FormError, FormScreen } from '../components/FormScreen';
import { TextField } from '../components/TextField';
import { useAuthAction } from '../hooks/useAuthAction';
import { colors } from '../theme';

interface ChangeEmailScreenProps {
  auth: AuthRepository;
  currentEmail: string | null;
  onBack: () => void;
}

export function ChangeEmailScreen({ auth, currentEmail, onBack }: ChangeEmailScreenProps) {
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { pending, error, run } = useAuthAction();

  const submit = () =>
    run(async () => {
      const normalised = email.trim().toLowerCase();
      await auth.updateEmail(normalised);
      setSentTo(normalised);
    });
  const canSubmit = !pending && email.trim() !== '';

  if (sentTo !== null) {
    return (
      <FormScreen
        title="Confirm your new email"
        description={`We sent a confirmation link to ${sentTo}. Your current address stays active until you open it.`}
      >
        {error && <FormError message={error.message} />}
        {!error && <Text style={styles.notice}>Confirmation link sent.</Text>}
        <View style={styles.actions}>
          <ActionButton label="Back to account" accent disabled={pending} onPress={onBack} />
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
      title="Change email"
      description={
        currentEmail
          ? `Currently ${currentEmail}. We’ll email a confirmation link to the new address.`
          : 'We’ll email a confirmation link to the new address.'
      }
    >
      <TextField
        label="New email"
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
          label={pending ? 'Sending…' : 'Send confirmation'}
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
