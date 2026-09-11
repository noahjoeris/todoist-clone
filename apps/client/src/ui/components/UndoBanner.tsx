import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';
import { ActionButton } from './ActionButton';

interface UndoBannerProps {
  message: string;
  pending: boolean;
  error: string | null;
  onUndo: () => void;
}

export function UndoBanner({ message, pending, error, onUndo }: UndoBannerProps) {
  return (
    <View accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.banner}>
      <Text style={styles.message}>{message}</Text>
      <ActionButton
        label={pending ? '…' : 'Undo'}
        accessibilityLabel="Undo delete"
        disabled={pending}
        onPress={onUndo}
      />
      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  message: { color: colors.text, fontSize: 14, flexGrow: 1, flexShrink: 1 },
  error: { color: colors.error, fontSize: 13, width: '100%' },
});
