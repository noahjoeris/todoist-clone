import type { ReactElement } from 'react';
import { FlatList, Pressable, StyleSheet, Text } from 'react-native';
import type { Task } from '../../data/repositories';
import { colors } from '../theme';

type ListRow = { key: string; task?: Task; completedHeader?: boolean };

interface TaskListProps {
  active: Task[];
  completed: Task[];
  completedExpanded: boolean;
  onToggleCompleted: () => void;
  renderTask: (task: Task) => ReactElement;
  header: ReactElement;
  empty: ReactElement | null;
}

/** Reusable active + collapsed-completed list for Inbox, Today, and Upcoming. */
export function TaskList({
  active,
  completed,
  completedExpanded,
  onToggleCompleted,
  renderTask,
  header,
  empty,
}: TaskListProps) {
  const rows: ListRow[] = [
    ...active.map((task) => ({ key: task.id, task })),
    ...(completed.length > 0 ? [{ key: 'completed-header', completedHeader: true }] : []),
    ...(completedExpanded ? completed.map((task) => ({ key: task.id, task })) : []),
  ];
  const showEmpty = active.length === 0 && completed.length === 0;

  return (
    <FlatList
      data={rows}
      keyExtractor={(row) => row.key}
      renderItem={({ item }) => {
        if (item.completedHeader) {
          return (
            <CompletedSectionHeader
              count={completed.length}
              expanded={completedExpanded}
              onPress={onToggleCompleted}
            />
          );
        }
        if (item.task) return renderTask(item.task);
        return null;
      }}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.content}
      ListHeaderComponent={header}
      ListEmptyComponent={showEmpty ? empty : null}
    />
  );
}

function CompletedSectionHeader({
  count,
  expanded,
  onPress,
}: {
  count: number;
  expanded: boolean;
  onPress: () => void;
}) {
  const label = count === 1 ? '1 completed task' : `${count} completed tasks`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded }}
      onPress={onPress}
      style={({ pressed }) => [styles.completedHeader, pressed && styles.pressed]}
    >
      <Text style={styles.chevron}>{expanded ? '▾' : '▸'}</Text>
      <Text style={styles.completedTitle}>Completed</Text>
      <Text style={styles.completedCount}>{count}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    width: '100%',
    maxWidth: 840,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 72,
    paddingBottom: 64,
  },
  completedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
    marginTop: 24,
    paddingVertical: 8,
  },
  pressed: { opacity: 0.7 },
  chevron: { color: colors.muted, fontSize: 14, width: 14 },
  completedTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },
  completedCount: { color: colors.muted, fontSize: 13 },
});
