import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';
import { ActionButton } from './ActionButton';
import { addCalendarDays, calendarDays } from './task-date';

interface TaskRescheduleMenuProps {
  today: string;
  onChoose: (date: string | null) => void;
  onClose: () => void;
}

export function TaskRescheduleMenu({ today, onChoose, onClose }: TaskRescheduleMenuProps) {
  const [choosing, setChoosing] = useState(false);
  const [month, setMonth] = useState(() => {
    const initial = new Date(`${today}T12:00:00`);
    return new Date(initial.getFullYear(), initial.getMonth(), 1);
  });

  if (!choosing) {
    return (
      <View style={styles.menu} accessibilityRole="menu">
        <ActionButton label="Today" onPress={() => onChoose(today)} />
        <ActionButton label="Tomorrow" onPress={() => onChoose(addCalendarDays(today, 1))} />
        <ActionButton label="Choose date" onPress={() => setChoosing(true)} />
        <ActionButton label="No date" onPress={() => onChoose(null)} />
        <ActionButton label="Cancel" accessibilityLabel="Cancel reschedule" onPress={onClose} />
      </View>
    );
  }

  return (
    <View style={styles.panel}>
      <View style={styles.monthRow}>
        <ActionButton
          label="‹"
          accessibilityLabel="Previous month"
          onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
        />
        <Text style={styles.text}>
          {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </Text>
        <ActionButton
          label="›"
          accessibilityLabel="Next month"
          onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
        />
      </View>
      <View style={styles.grid}>
        {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((day) => (
          <View key={day} style={styles.cell}>
            <Text style={styles.muted}>{day}</Text>
          </View>
        ))}
        {calendarDays(month).map((day) =>
          day.day !== null ? (
            <Pressable
              key={day.date}
              accessibilityRole="button"
              accessibilityLabel={day.date}
              onPress={() => onChoose(day.date)}
              style={({ pressed }) => [styles.cell, pressed && styles.hover]}
            >
              <Text style={[styles.text, day.date === today && styles.today]}>{day.day}</Text>
            </Pressable>
          ) : (
            <View key={day.date} style={styles.cell} />
          ),
        )}
      </View>
      <ActionButton label="Cancel" accessibilityLabel="Cancel date picker" onPress={onClose} />
    </View>
  );
}

const styles = StyleSheet.create({
  menu: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 8 },
  panel: {
    width: '100%',
    maxWidth: 340,
    padding: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  text: { color: colors.text, fontSize: 14 },
  muted: { color: colors.muted, fontSize: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: {
    width: '14.285714%',
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  hover: { backgroundColor: colors.hover },
  today: { color: colors.green },
});
