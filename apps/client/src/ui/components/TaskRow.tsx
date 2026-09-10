import { StyleSheet, Text, View } from 'react-native';
import type { Task } from '../../data/repositories';
import { colors, priorityColors } from '../theme';
import { dateLabel } from './task-date';

export function TaskRow({ task }: { task: Task }) {
  return (
    <View style={styles.row}>
      <View style={[styles.priority, { backgroundColor: priorityColors[task.priority] }]} />
      <View style={styles.content}>
        <Text style={styles.title}>{task.title}</Text>
        {!!task.description && <Text style={styles.description}>{task.description}</Text>}
        <View style={styles.metadata}>
          {task.scheduledDate && (
            <Text style={styles.date}>
              {dateLabel(task.scheduledDate)}
              {task.scheduledTime ? ` · ${task.scheduledTime}` : ''}
            </Text>
          )}
          <Text style={[styles.label, { color: priorityColors[task.priority] }]}>
            P{task.priority}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 14,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  priority: { width: 4, height: 18, borderRadius: 2, marginTop: 2 },
  content: { flex: 1, gap: 5 },
  title: { color: colors.text, fontSize: 16, lineHeight: 23 },
  description: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  metadata: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 3 },
  date: { color: colors.green, fontSize: 12 },
  label: { fontSize: 12 },
});
