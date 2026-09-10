import { useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { type TaskInput, type TaskPriority, taskInputSchema } from '../../data/repositories';
import { colors, priorityColors } from '../theme';
import { ActionButton } from './ActionButton';
import { TaskDatePicker } from './TaskDatePicker';
import { dateLabel } from './task-date';

interface TaskComposerProps {
  onCreate: (input: TaskInput) => Promise<void>;
  onClose: () => void;
}

export function TaskComposer({ onCreate, onClose }: TaskComposerProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>(4);
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState('');
  const [panel, setPanel] = useState<'date' | 'priority' | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);

  async function submit() {
    if (submitting.current) return;
    const result = taskInputSchema.safeParse({
      title,
      description,
      priority,
      scheduledDate: date,
      scheduledTime: time.trim() || null,
    });
    if (!result.success) {
      setError(
        result.error.issues[0]?.path[0] === 'scheduledTime'
          ? 'Enter a valid 24-hour time, such as 14:30, or leave it empty.'
          : (result.error.issues[0]?.message ?? 'Check your task details.'),
      );
      return;
    }
    submitting.current = true;
    setSaving(true);
    setError(null);
    setPanel(null);
    try {
      await onCreate(result.data);
      onClose();
    } catch {
      setError('Couldn’t save your task. Your draft is here—try again.');
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  function close() {
    if (!submitting.current) onClose();
  }

  return (
    <View style={styles.composer}>
      <TextInput
        accessibilityLabel="Task name"
        placeholder="Task name"
        placeholderTextColor={colors.muted}
        value={title}
        onChangeText={setTitle}
        autoFocus
        editable={!saving}
        style={styles.title}
        returnKeyType="done"
        submitBehavior="submit"
        onSubmitEditing={() => void submit()}
        onKeyPress={({ nativeEvent }) => {
          if (nativeEvent.key === 'Escape') close();
        }}
      />
      <TextInput
        accessibilityLabel="Description"
        placeholder="Description"
        placeholderTextColor={colors.muted}
        value={description}
        onChangeText={setDescription}
        editable={!saving}
        multiline
        style={styles.description}
        onKeyPress={({ nativeEvent }) => {
          if (nativeEvent.key === 'Escape') close();
        }}
      />
      <View style={styles.toolbar}>
        <View style={styles.options}>
          <ActionButton
            label={date ? `${dateLabel(date)}${time ? ` · ${time}` : ''}` : 'Date'}
            accessibilityLabel="Choose date and time"
            color={date ? colors.green : colors.muted}
            disabled={saving}
            selected={panel === 'date'}
            onPress={() => setPanel(panel === 'date' ? null : 'date')}
          />
          <ActionButton
            label={priority === 4 ? '⚑ Priority' : `⚑ P${priority}`}
            accessibilityLabel={`Priority ${priority}. Change priority`}
            color={priorityColors[priority]}
            disabled={saving}
            selected={panel === 'priority'}
            onPress={() => setPanel(panel === 'priority' ? null : 'priority')}
          />
        </View>
        <View style={styles.actions}>
          <ActionButton
            label="×"
            accessibilityLabel="Cancel task"
            onPress={close}
            disabled={saving}
          />
          <ActionButton
            label={saving ? '…' : '↑'}
            accessibilityLabel={saving ? 'Saving task' : 'Add task'}
            onPress={() => void submit()}
            disabled={saving || !title.trim()}
            accent
          />
        </View>
      </View>
      {panel === 'date' && (
        <TaskDatePicker
          date={date}
          time={time}
          onDateChange={setDate}
          onTimeChange={setTime}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === 'priority' && (
        <View style={styles.priorities}>
          {([1, 2, 3, 4] as const).map((value) => (
            <ActionButton
              key={value}
              label={`⚑ P${value}`}
              accessibilityLabel={`Priority ${value}`}
              color={priorityColors[value]}
              selected={priority === value}
              onPress={() => {
                setPriority(value);
                setPanel(null);
              }}
            />
          ))}
        </View>
      )}
      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  composer: {
    borderWidth: 1,
    borderColor: '#686868',
    borderRadius: 16,
    backgroundColor: colors.surface,
    padding: 16,
    gap: 12,
  },
  title: { color: colors.text, fontSize: 20, padding: 0, minHeight: 32 },
  description: {
    color: colors.text,
    fontSize: 15,
    padding: 0,
    minHeight: 32,
    maxHeight: 160,
    textAlignVertical: 'top',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'space-between',
    marginTop: 4,
  },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, flexShrink: 1 },
  actions: { flexDirection: 'row', gap: 8, marginLeft: 'auto' },
  priorities: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  error: { color: colors.error, fontSize: 14 },
});
