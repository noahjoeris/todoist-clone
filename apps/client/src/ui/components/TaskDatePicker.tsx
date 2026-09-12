import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '../theme';
import { ActionButton } from './ActionButton';
import { addCalendarDays, calendarDays, toCalendarDate } from './task-date';

interface TaskDatePickerProps {
  date: string | null;
  time: string;
  today?: string;
  onDateChange: (date: string | null) => void;
  onTimeChange: (time: string) => void;
  onClose: () => void;
}

export function TaskDatePicker({
  date,
  time,
  today: todayProp,
  onDateChange,
  onTimeChange,
  onClose,
}: TaskDatePickerProps) {
  const [month, setMonth] = useState(() => {
    const initial = date ? new Date(`${date}T12:00:00`) : new Date();
    return new Date(initial.getFullYear(), initial.getMonth(), 1);
  });
  const today = todayProp ?? toCalendarDate(new Date());

  function chooseDate(value: string) {
    onDateChange(value);
    const selected = new Date(`${value}T12:00:00`);
    setMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
  }

  return (
    <View style={styles.panel}>
      <Text style={styles.heading}>Date</Text>
      <View style={styles.row}>
        <ActionButton label="Today" onPress={() => chooseDate(today)} />
        <ActionButton label="Tomorrow" onPress={() => chooseDate(addCalendarDays(today, 1))} />
      </View>
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
              accessibilityState={{ selected: date === day.date }}
              onPress={() => chooseDate(day.date)}
              style={({ pressed }) => [
                styles.cell,
                pressed && styles.hover,
                date === day.date && styles.selected,
              ]}
            >
              <Text
                style={[
                  styles.text,
                  day.date === today && styles.today,
                  date === day.date && styles.selectedText,
                ]}
              >
                {day.day}
              </Text>
            </Pressable>
          ) : (
            <View key={day.date} style={styles.cell} />
          ),
        )}
      </View>
      <View style={styles.timeRow}>
        <Text style={styles.text}>
          Time <Text style={styles.muted}>(optional)</Text>
        </Text>
        <TextInput
          accessibilityLabel="Time (24-hour HH:mm)"
          placeholder="HH:mm"
          placeholderTextColor={colors.muted}
          value={time}
          onChangeText={onTimeChange}
          editable={date !== null}
          autoCorrect={false}
          maxLength={5}
          style={[styles.timeInput, date === null && styles.disabled]}
        />
      </View>
      <Text style={styles.hint}>
        {date ? '24-hour time, e.g. 14:30' : 'Choose a date to add a time.'}
      </Text>
      <View style={styles.monthRow}>
        <ActionButton
          label="No date"
          onPress={() => {
            onDateChange(null);
            onTimeChange('');
            onClose();
          }}
        />
        <ActionButton label="Done" onPress={onClose} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
  heading: { color: colors.text, fontSize: 15, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
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
  selected: { backgroundColor: colors.accent },
  today: { color: colors.green },
  selectedText: { color: '#ffffff', fontWeight: '600' },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  timeInput: {
    color: colors.text,
    padding: 10,
    minHeight: 44,
    width: 84,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    fontSize: 14,
  },
  disabled: { opacity: 0.4 },
  hint: { color: colors.muted, fontSize: 12 },
});
