import { describe, expect, it } from 'vitest';
import {
  addCalendarDays,
  calendarDays,
  dateLabel,
  millisecondsUntilLocalMidnight,
  toCalendarDate,
  upcomingBounds,
} from './task-date';

describe('calendar dates', () => {
  it('uses local calendar components, including near midnight', () => {
    expect(toCalendarDate(new Date(2026, 8, 9, 0, 5))).toBe('2026-09-09');
    expect(toCalendarDate(new Date(2026, 8, 9, 23, 55))).toBe('2026-09-09');
  });

  it('labels today and tomorrow across a year boundary', () => {
    const now = new Date(2026, 11, 31, 23);
    expect(dateLabel('2026-12-31', now)).toBe('Today');
    expect(dateLabel('2027-01-01', now)).toBe('Tomorrow');
  });

  it('does not shift a date when formatting in a timezone behind UTC', () => {
    const result = dateLabel('2026-01-15', new Date(2026, 0, 1));
    expect(result).toContain('15');
  });

  it('builds a Monday-first grid with leap day and unique cell keys', () => {
    const days = calendarDays(new Date(2028, 1, 1));
    const dates = days.filter((cell) => cell.day !== null);
    expect(days[0]).toEqual({ date: '2028-01-31', day: null });
    expect(dates).toHaveLength(29);
    expect(dates.at(-1)).toEqual({ date: '2028-02-29', day: 29 });
    expect(days.length % 7).toBe(0);
    expect(new Set(days.map((cell) => cell.date)).size).toBe(days.length);
  });

  it('supports a month spanning six calendar rows', () => {
    expect(calendarDays(new Date(2026, 2, 1))).toHaveLength(42);
  });

  it('adds calendar days across month, year, and leap-day boundaries', () => {
    expect(addCalendarDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addCalendarDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addCalendarDays('2028-02-29', 1)).toBe('2028-03-01');
    expect(addCalendarDays('2026-09-13', 30)).toBe('2026-10-13');
  });

  it('does not skip a local calendar day when a 24-hour duration would', () => {
    const start = new Date(2026, 2, 8, 0, 0, 0);
    expect(addCalendarDays(toCalendarDate(start), 1)).toBe('2026-03-09');
    expect(addCalendarDays('2026-03-08', 1)).toBe(toCalendarDate(new Date(2026, 2, 9)));
  });

  it('builds an exclusive upcoming window starting tomorrow', () => {
    expect(upcomingBounds('2026-09-12', 30)).toEqual({
      startInclusive: '2026-09-13',
      endExclusive: '2026-10-13',
    });
  });

  it('measures time until local midnight without a fixed 24-hour duration', () => {
    const evening = new Date(2026, 8, 12, 23, 0, 0);
    expect(millisecondsUntilLocalMidnight(evening)).toBe(60 * 60 * 1000);
    const almost = new Date(2026, 8, 12, 23, 59, 59, 500);
    expect(millisecondsUntilLocalMidnight(almost)).toBe(500);
  });
});
