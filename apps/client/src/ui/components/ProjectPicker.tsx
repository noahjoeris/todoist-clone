import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ProjectListItem } from '../../data/repositories';
import { inboxMatchesQuery, projectPickerChoices } from '../project-picker';
import { colors, hexForLabelColor } from '../theme';

interface ProjectPickerProps {
  projects: readonly ProjectListItem[];
  selectedId: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
}

export function ProjectPicker({
  projects,
  selectedId,
  onChange,
  disabled = false,
}: ProjectPickerProps) {
  const [query, setQuery] = useState('');
  const showInbox = inboxMatchesQuery(query);
  const visible = useMemo(
    () => projectPickerChoices(projects, selectedId, query),
    [projects, selectedId, query],
  );
  const selectedArchived =
    selectedId != null
      ? (projects.find((project) => project.id === selectedId)?.isArchived ?? false)
      : false;

  function select(id: string | null) {
    if (disabled) return;
    onChange(id);
  }

  return (
    <View style={styles.panel}>
      <TextInput
        accessibilityLabel="Search projects"
        placeholder="Search projects"
        placeholderTextColor={colors.muted}
        value={query}
        onChangeText={setQuery}
        editable={!disabled}
        style={styles.search}
      />
      {selectedArchived && (
        <Text style={styles.notice}>This project is archived. Saving keeps it there.</Text>
      )}
      <ScrollView
        accessibilityRole="radiogroup"
        accessibilityLabel="Projects"
        style={styles.list}
        keyboardShouldPersistTaps="handled"
      >
        {showInbox && (
          <Pressable
            accessibilityRole="radio"
            accessibilityLabel="Inbox"
            accessibilityState={{ selected: selectedId == null, disabled }}
            disabled={disabled}
            onPress={() => select(null)}
            style={({ pressed }) => [styles.option, pressed && styles.pressed]}
          >
            <View style={[styles.dot, { backgroundColor: colors.muted }]} />
            <Text style={styles.optionLabel}>Inbox</Text>
            {selectedId == null && <Text style={styles.check}>✓</Text>}
          </Pressable>
        )}
        {visible.map((project) => {
          const isSelected = selectedId === project.id;
          const label = project.archived ? `${project.name}, archived` : project.name;
          return (
            <Pressable
              key={project.id}
              accessibilityRole="radio"
              accessibilityLabel={label}
              accessibilityState={{ selected: isSelected, disabled }}
              disabled={disabled}
              onPress={() => select(project.id)}
              style={({ pressed }) => [styles.option, pressed && styles.pressed]}
            >
              <View
                style={[
                  styles.dot,
                  { backgroundColor: hexForLabelColor(project.color ?? 'charcoal') },
                ]}
              />
              <Text style={styles.optionLabel}>{project.name}</Text>
              {project.archived && <Text style={styles.archived}>Archived</Text>}
              {isSelected && <Text style={styles.check}>✓</Text>}
            </Pressable>
          );
        })}
        {!showInbox && visible.length === 0 && (
          <Text style={styles.empty}>No projects match that search.</Text>
        )}
      </ScrollView>
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
  notice: { color: colors.muted, fontSize: 13, paddingHorizontal: 4 },
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
  archived: { color: colors.muted, fontSize: 12 },
  check: { color: colors.green, fontSize: 16, fontWeight: '700' },
  empty: { color: colors.muted, fontSize: 14, paddingHorizontal: 8, paddingVertical: 12 },
});
