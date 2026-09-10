export function toCalendarDate(date: Date): string {
  return `${date.getFullYear().toString().padStart(4, '0')}-${(date.getMonth() + 1)
    .toString()
    .padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
}

export function dateLabel(date: string, now = new Date()): string {
  if (date === toCalendarDate(now)) return 'Today';
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (date === toCalendarDate(tomorrow)) return 'Tomorrow';
  // Parse in local time: parsing YYYY-MM-DD alone interprets it as UTC.
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(date.slice(0, 4) !== String(now.getFullYear()) ? { year: 'numeric' } : {}),
  });
}

export function calendarDays(month: Date): Array<{ date: string; day: number | null }> {
  const offset = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7;
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  return Array.from({ length: Math.ceil((offset + count) / 7) * 7 }, (_, index) => {
    const day = index - offset + 1;
    return {
      day: day < 1 || day > count ? null : day,
      date: toCalendarDate(new Date(month.getFullYear(), month.getMonth(), day)),
    };
  });
}
