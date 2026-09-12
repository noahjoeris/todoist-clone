import { StyleSheet, Text, View } from 'react-native';
import type { LabelSummary } from '../../data/repositories';
import { colors, hexForLabelColor } from '../theme';

export function LabelChip({ label, muted = false }: { label: LabelSummary; muted?: boolean }) {
  const hex = hexForLabelColor(label.color);
  return (
    <View accessibilityLabel={`${label.name} label`} style={[styles.chip, muted && styles.muted]}>
      <View style={[styles.dot, { backgroundColor: hex }]} />
      <Text style={[styles.name, muted && styles.mutedName]}>{label.name}</Text>
    </View>
  );
}

export function LabelChipRow({
  labels,
  muted = false,
}: {
  labels: readonly LabelSummary[];
  muted?: boolean;
}) {
  if (labels.length === 0) return null;
  return (
    <View style={styles.row}>
      {labels.map((label) => (
        <LabelChip key={label.id} label={label} muted={muted} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
  },
  muted: { opacity: 0.8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  name: { color: colors.muted, fontSize: 12 },
  mutedName: { color: colors.muted },
});
