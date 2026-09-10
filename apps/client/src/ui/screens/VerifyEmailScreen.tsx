import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { AuthRepository } from '../../data/repositories';
import { ActionButton } from '../components/ActionButton';
import { FormError, FormScreen } from '../components/FormScreen';
import { TextField } from '../components/TextField';
import { useAuthAction } from '../hooks/useAuthAction';
import { colors } from '../theme';

interface VerifyEmailScreenProps {
  auth: AuthRepository;
  email: string;
  onBackToSignIn: () => void;
}

export function VerifyEmailScreen({ auth, email, onBackToSignIn }: VerifyEmailScreenProps) {
  const [code, setCode] = useState('');
  const [resent, setResent] = useState(false);
  const verify = useAuthAction();
  const resend = useAuthAction();

  const submit = () => verify.run(() => auth.verifyEmail(email, code));
  const resendCode = () =>
    resend.run(async () => {
      setResent(false);
      await auth.resendVerification(email);
      setResent(true);
    });
  const busy = verify.pending || resend.pending;

  return (
    <FormScreen
      title="Check your email"
      description={`Enter the 6-digit code we sent to ${email}. It expires after a short while.`}
    >
      <TextField
        label="Verification code"
        value={code}
        onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        autoFocus
        editable={!busy}
        maxLength={6}
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
      />
      {verify.error && <FormError message={verify.error.message} />}
      {resend.error && <FormError message={resend.error.message} />}
      {resent && !resend.error && <Text style={styles.notice}>New code sent.</Text>}
      <View style={styles.actions}>
        <ActionButton
          label={verify.pending ? 'Verifying…' : 'Verify'}
          accent
          disabled={busy || code.length !== 6}
          onPress={() => void submit()}
        />
        <ActionButton
          label={resend.pending ? 'Sending…' : 'Resend code'}
          disabled={busy}
          onPress={() => void resendCode()}
        />
        <ActionButton
          label="Back to sign in"
          color={colors.muted}
          disabled={busy}
          onPress={onBackToSignIn}
        />
      </View>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  notice: { color: colors.green, fontSize: 14 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
