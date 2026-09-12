import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Task } from '../../data/repositories';
import { colors, priorityColors } from '../theme';
import { TaskRescheduleMenu } from './TaskRescheduleMenu';
import { dateLabel } from './task-date';

interface TaskRowProps {
  task: Task;
  onOpen: (task: Task) => void;
  onSetCompletion: (task: Task, completed: boolean) => void;
  disabled?: boolean;
  today?: string;
  rescheduleOpen?: boolean;
  onRescheduleOpen?: () => void;
  onRescheduleClose?: () => void;
  onReschedule?: (date: string | null) => void;
}

export function TaskRow({
  task,
  onOpen,
  onSetCompletion,
  disabled = false,
  today,
  rescheduleOpen = false,
  onRescheduleOpen,
  onRescheduleClose,
  onReschedule,
}: TaskRowProps) {
  const completed = task.completedAt != null;
  const now = today ? new Date(`${today}T12:00:00`) : new Date();
  return (
    <View>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityLabel={completed ? `Reopen ${task.title}` : `Complete ${task.title}`}
          accessibilityState={{ checked: completed, disabled }}
          disabled={disabled}
          hitSlop={8}
          onPress={() => onSetCompletion(task, !completed)}
          style={({ pressed }) => [styles.checkbox, pressed && styles.pressed]}
        >
          <View style={[styles.box, completed && styles.boxChecked]}>
            {completed ? <Text style={styles.checkMark}>✓</Text> : null}
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Edit ${task.title}`}
          disabled={disabled}
          onPress={() => onOpen(task)}
          style={({ pressed }) => [styles.content, pressed && styles.pressed]}
        >
          <View style={[styles.priority, { backgroundColor: priorityColors[task.priority] }]} />
          <View style={styles.body}>
            <Text style={[styles.title, completed && styles.completedTitle]}>{task.title}</Text>
            {!!task.description && (
              <Text style={[styles.description, completed && styles.completedMeta]}>
                {task.description}
              </Text>
            )}
            <View style={styles.metadata}>
              {task.scheduledDate && (
                <Text style={[styles.date, completed && styles.completedMeta]}>
                  {dateLabel(task.scheduledDate, now)}
                  {task.scheduledTime ? ` · ${task.scheduledTime}` : ''}
                </Text>
              )}
              <Text
                style={[
                  styles.label,
                  { color: completed ? colors.muted : priorityColors[task.priority] },
                ]}
              >
                P{task.priority}
              </Text>
            </View>
          </View>
        </Pressable>
        {onRescheduleOpen && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Reschedule ${task.title}`}
            disabled={disabled}
            onPress={onRescheduleOpen}
            style={({ pressed }) => [styles.reschedule, pressed && styles.pressed]}
          >
            <Text style={styles.rescheduleLabel}>{task.scheduledDate ? 'Schedule' : 'Date'}</Text>
          </Pressable>
        )}
      </View>
      {rescheduleOpen && today && onReschedule && onRescheduleClose ? (
        <TaskRescheduleMenu today={today} onChoose={onReschedule} onClose={onRescheduleClose} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  checkbox: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  box: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxChecked: {
    backgroundColor: colors.green,
    borderColor: colors.green,
  },
  checkMark: { color: '#1e1e1e', fontSize: 12, fontWeight: '700', lineHeight: 14 },
  content: { flex: 1, flexDirection: 'row', gap: 14, paddingVertical: 6 },
  pressed: { opacity: 0.7 },
  priority: { width: 4, height: 18, borderRadius: 2, marginTop: 2 },
  body: { flex: 1, gap: 5 },
  title: { color: colors.text, fontSize: 16, lineHeight: 23 },
  completedTitle: { color: colors.muted, textDecorationLine: 'line-through' },
  description: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  completedMeta: { color: colors.muted },
  metadata: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 3 },
  date: { color: colors.green, fontSize: 12 },
  label: { fontSize: 12 },
  reschedule: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  rescheduleLabel: { color: colors.muted, fontSize: 12 },
});
