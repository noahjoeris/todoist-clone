import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { LabelDuplicateNameError, type LabelSummary } from '../../data/repositories';
import { filterLabelsByQuery, inlineCreateName } from '../label-picker';
import { colors, hexForLabelColor } from '../theme';

interface LabelPickerProps {
  labels: readonly LabelSummary[];
  selectedIds: readonly string[];
  onChange: (ids: string[]) => void;
  onCreate: (name: string) => Promise<{ id: string }>;
  disabled?: boolean;
}

export function LabelPicker({
  labels,
  selectedIds,
  onChange,
  onCreate,
  disabled = false,
}: LabelPickerProps) {
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const visible = filterLabelsByQuery([...labels], query);
  const createName = inlineCreateName(query, labels);

  function toggle(id: string) {
    if (disabled) return;
    if (selected.has(id)) onChange(selectedIds.filter((item) => item !== id));
    else onChange([...selectedIds, id]);
  }

  async function create() {
    if (!createName || creating || disabled) return;
    setCreating(true);
    setError(null);
    try {
      const created = await onCreate(createName);
      onChange([...selectedIds, created.id]);
      setQuery('');
    } catch (cause) {
      setError(
        cause instanceof LabelDuplicateNameError
          ? cause.message
          : 'Couldn’t create that label. Try again.',
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <View style={styles.panel}>
      <TextInput
        accessibilityLabel="Search labels"
        placeholder="Search labels"
        placeholderTextColor={colors.muted}
        value={query}
        onChangeText={(value) => {
          setQuery(value);
          setError(null);
        }}
        editable={!disabled}
        style={styles.search}
      />
      <ScrollView accessibilityRole="list" style={styles.list} keyboardShouldPersistTaps="handled">
        {visible.map((label) => {
          const isSelected = selected.has(label.id);
          return (
            <Pressable
              key={label.id}
              accessibilityRole="checkbox"
              accessibilityLabel={label.name}
              accessibilityState={{ checked: isSelected, disabled }}
              disabled={disabled}
              onPress={() => toggle(label.id)}
              style={({ pressed }) => [styles.option, pressed && styles.pressed]}
            >
              <View style={[styles.dot, { backgroundColor: hexForLabelColor(label.color) }]} />
              <Text style={styles.optionLabel}>{label.name}</Text>
              {isSelected && <Text style={styles.check}>✓</Text>}
            </Pressable>
          );
        })}
        {visible.length === 0 && !createName && (
          <Text style={styles.empty}>No labels match that search.</Text>
        )}
        {createName && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Create label ${createName}`}
            disabled={disabled || creating}
            onPress={() => void create()}
            style={({ pressed }) => [styles.option, pressed && styles.pressed]}
          >
            <Text style={styles.create}>{creating ? 'Creating…' : `Create “${createName}”`}</Text>
          </Pressable>
        )}
      </ScrollView>
      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 8 },
  search: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 9,
    backgroundColor: colors.background,
    color: colors.text,
    fontSize: 15,
  },
  list: { gap: 2, maxHeight: 240 },
  option: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 8,
    borderRadius: 9,
  },
  pressed: { backgroundColor: colors.hover },
  dot: { width: 10, height: 10, borderRadius: 5 },
  optionLabel: { color: colors.text, fontSize: 15, flex: 1 },
  check: { color: colors.green, fontSize: 16, fontWeight: '700' },
  create: { color: colors.accent, fontSize: 15, fontWeight: '600' },
  empty: { color: colors.muted, fontSize: 14, paddingHorizontal: 8, paddingVertical: 12 },
  error: { color: colors.error, fontSize: 14 },
});
