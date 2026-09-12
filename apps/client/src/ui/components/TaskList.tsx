import type { ReactElement } from 'react';
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import type { Task } from '../../data/repositories';
import { colors } from '../theme';
import { ActionButton } from './ActionButton';

export type TaskSection = {
  key: string;
  title?: string;
  tasks: Task[];
  onAdd?: () => void;
};

type ListItem = { kind: 'task'; task: Task } | { kind: 'load-more' };

type ListSection = {
  key: string;
  title?: string;
  onAdd?: () => void;
  completed?: boolean;
  data: ListItem[];
};

interface TaskListProps {
  sections: TaskSection[];
  completed: Task[];
  completedExpanded: boolean;
  onToggleCompleted: () => void;
  renderTask: (task: Task) => ReactElement;
  header: ReactElement;
  empty: ReactElement | null;
  loadMore?: { label: string; onPress: () => void };
}

/** Reusable active + collapsed-completed list for Inbox, Today, and Upcoming. */
export function TaskList({
  sections,
  completed,
  completedExpanded,
  onToggleCompleted,
  renderTask,
  header,
  empty,
  loadMore,
}: TaskListProps) {
  const listSections: ListSection[] = [
    ...sections.map((section) => ({
      key: section.key,
      ...(section.title !== undefined ? { title: section.title } : {}),
      ...(section.onAdd ? { onAdd: section.onAdd } : {}),
      data: section.tasks.map((task) => ({ kind: 'task' as const, task })),
    })),
    ...(loadMore
      ? [{ key: 'load-more', data: [{ kind: 'load-more' as const }] satisfies ListItem[] }]
      : []),
    ...(completed.length > 0
      ? [
          {
            key: 'completed',
            completed: true,
            data: completedExpanded
              ? completed.map((task) => ({ kind: 'task' as const, task }))
              : [],
          },
        ]
      : []),
  ];
  const showEmpty =
    sections.every((section) => section.tasks.length === 0) && completed.length === 0;

  return (
    <SectionList
      sections={listSections}
      keyExtractor={(item, index) => (item.kind === 'task' ? item.task.id : `load-more-${index}`)}
      renderItem={({ item }) => {
        if (item.kind === 'load-more') {
          return (
            <View style={styles.loadMore}>
              <ActionButton
                label={loadMore?.label ?? 'Load more'}
                accessibilityLabel="Load more upcoming days"
                onPress={() => loadMore?.onPress()}
              />
            </View>
          );
        }
        return renderTask(item.task);
      }}
      renderSectionHeader={({ section }) => {
        if (section.completed) {
          return (
            <CompletedSectionHeader
              count={completed.length}
              expanded={completedExpanded}
              onPress={onToggleCompleted}
            />
          );
        }
        if (!section.title) return null;
        return (
          <View style={styles.sectionHeader}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>
              {section.title}
            </Text>
            {section.onAdd && (
              <ActionButton
                label="+ Add task"
                accessibilityLabel={`Add task on ${section.title}`}
                color={colors.accent}
                onPress={section.onAdd}
              />
            )}
          </View>
        );
      }}
      stickySectionHeadersEnabled={false}
      extraData={completedExpanded}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.content}
      ListHeaderComponent={
        <>
          {header}
          {showEmpty ? empty : null}
        </>
      }
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
    paddingTop: 24,
    paddingBottom: 64,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 44,
    marginTop: 20,
    marginBottom: 4,
  },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },
  loadMore: { alignSelf: 'flex-start', marginTop: 16 },
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
