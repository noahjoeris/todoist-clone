import { forwardRef, useState } from 'react';
import { Pressable, StyleSheet, Text, type View } from 'react-native';
import { colors } from '../theme';

interface ActionButtonProps {
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
  disabled?: boolean;
  selected?: boolean;
  accent?: boolean;
  color?: string;
}

export const ActionButton = forwardRef<View, ActionButtonProps>(function ActionButton(
  {
    label,
    accessibilityLabel,
    onPress,
    disabled = false,
    selected = false,
    accent = false,
    color = colors.text,
  },
  ref,
) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [
        styles.button,
        (pressed || hovered || selected) && styles.active,
        accent && styles.accent,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.label, { color: accent ? '#ffffff' : color }]}>{label}</Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  active: { backgroundColor: colors.hover },
  accent: { backgroundColor: colors.accent, borderColor: colors.accent },
  disabled: { opacity: 0.4 },
  label: { fontSize: 14, fontWeight: '500' },
});
