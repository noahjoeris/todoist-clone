import { Pressable, StyleSheet, View } from 'react-native';
import type { LabelColor } from '../../data/repositories';
import { colors, hexForLabelColor, labelColorList, nameForLabelColor } from '../theme';

export function LabelColorPicker({
  value,
  onChange,
  disabled = false,
  accessibilityLabel = 'Label color',
}: {
  value: LabelColor;
  onChange: (color: LabelColor) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <View
      style={styles.grid}
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
    >
      {labelColorList.map((color) => {
        const selected = color === value;
        const name = nameForLabelColor(color);
        return (
          <Pressable
            key={color}
            accessibilityRole="radio"
            accessibilityLabel={name}
            accessibilityState={{ selected, disabled }}
            disabled={disabled}
            onPress={() => onChange(color)}
            style={({ pressed }) => [
              styles.swatch,
              selected && styles.selected,
              pressed && styles.pressed,
            ]}
          >
            <View style={[styles.dot, { backgroundColor: hexForLabelColor(color) }]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  swatch: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  selected: { borderColor: colors.text, backgroundColor: colors.hover },
  pressed: { opacity: 0.7 },
  dot: { width: 18, height: 18, borderRadius: 9 },
});
