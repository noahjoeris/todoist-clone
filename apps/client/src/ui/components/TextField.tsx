import { StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';
import { colors } from '../theme';

interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
}

/** Labelled single-line input in the app's dark style. */
export function TextField({ label, editable = true, ...inputProps }: TextFieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        editable={editable}
        style={[styles.input, !editable && styles.disabled]}
        {...inputProps}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  label: { color: colors.muted, fontSize: 13, fontWeight: '500' },
  input: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 9,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 16,
  },
  disabled: { opacity: 0.6 },
});
