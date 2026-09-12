export function toCalendarDate(date: Date): string {
  return `${date.getFullYear().toString().padStart(4, '0')}-${(date.getMonth() + 1)
    .toString()
    .padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
}

/** Local calendar arithmetic. Do not add a fixed 24-hour millisecond duration. */
export function addCalendarDays(date: string, amount: number): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  return toCalendarDate(new Date(year, month - 1, day + amount));
}

export function upcomingBounds(
  today: string,
  dayCount: number,
): { startInclusive: string; endExclusive: string } {
  const startInclusive = addCalendarDays(today, 1);
  return { startInclusive, endExclusive: addCalendarDays(startInclusive, dayCount) };
}

export function millisecondsUntilLocalMidnight(now: Date): number {
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return Math.max(1, nextMidnight.getTime() - now.getTime());
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
