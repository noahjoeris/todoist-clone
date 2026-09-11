import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AuthFailure, type AuthRepository, MIN_PASSWORD_LENGTH } from '../../data/repositories';
import { ActionButton } from '../components/ActionButton';
import { FormError, FormScreen } from '../components/FormScreen';
import { TextField } from '../components/TextField';
import { useAuthAction } from '../hooks/useAuthAction';
import { colors } from '../theme';

interface UpdatePasswordScreenProps {
  auth: AuthRepository;
  /** Recovery forces a new password after the reset link; change is from Account. */
  mode: 'recovery' | 'change';
  onBack?: () => void;
}

export function UpdatePasswordScreen({ auth, mode, onBack }: UpdatePasswordScreenProps) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const { pending, error, run } = useAuthAction();

  const submit = () =>
    run(async () => {
      if (password !== confirm) {
        throw new AuthFailure('invalid-input', 'Passwords don’t match.');
      }
      await auth.updatePassword(password);
    });
  const canSubmit = !pending && password.length >= MIN_PASSWORD_LENGTH && confirm.length > 0;

  return (
    <FormScreen
      title={mode === 'recovery' ? 'Set a new password' : 'Change password'}
      description={
        mode === 'recovery'
          ? `Choose a new password of at least ${MIN_PASSWORD_LENGTH} characters.`
          : `Use at least ${MIN_PASSWORD_LENGTH} characters.`
      }
    >
      <TextField
        label="New password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        autoFocus
        editable={!pending}
        returnKeyType="next"
      />
      <TextField
        label="Confirm password"
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        editable={!pending}
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
      />
      {error && <FormError message={error.message} />}
      <View style={styles.actions}>
        <ActionButton
          label={pending ? 'Saving…' : mode === 'recovery' ? 'Save password' : 'Update password'}
          accent
          disabled={!canSubmit}
          onPress={() => void submit()}
        />
        {onBack && (
          <ActionButton label="Back" color={colors.muted} disabled={pending} onPress={onBack} />
        )}
      </View>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
