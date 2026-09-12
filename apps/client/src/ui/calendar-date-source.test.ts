import { describe, expect, it } from 'vitest';
import { createCalendarDateSource } from './calendar-date-source';

describe('calendar date source', () => {
  it('refreshes at local midnight using the injected clock', () => {
    const now = { current: new Date(2026, 8, 12, 23, 59, 50) };
    const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
    const source = createCalendarDateSource({
      clock: { now: () => now.current },
      schedule: (callback, delayMs) => {
        scheduled.push({ callback, delayMs });
        return () => {};
      },
    });
    const listener = { calls: 0 };
    source.subscribe(() => {
      listener.calls += 1;
    });

    expect(source.getToday()).toBe('2026-09-12');
    expect(scheduled[0]?.delayMs).toBe(10_000);

    now.current = new Date(2026, 8, 13, 0, 0, 0);
    scheduled[0]?.callback();
    expect(source.getToday()).toBe('2026-09-13');
    expect(listener.calls).toBe(1);
    expect(scheduled[1]?.delayMs).toBe(24 * 60 * 60 * 1000);
    source.dispose();
  });

  it('refreshes on foreground when the local date changed, including timezone-sensitive today', () => {
    const now = { current: new Date(2026, 8, 12, 22, 0, 0) };
    let foreground: (() => void) | undefined;
    const source = createCalendarDateSource({
      clock: { now: () => now.current },
      schedule: () => () => {},
      onForeground: (listener) => {
        foreground = listener;
        return () => {
          foreground = undefined;
        };
      },
    });
    const listener = { calls: 0 };
    source.subscribe(() => {
      listener.calls += 1;
    });

    foreground?.();
    expect(source.getToday()).toBe('2026-09-12');
    expect(listener.calls).toBe(0);

    now.current = new Date(2026, 8, 13, 0, 30, 0);
    foreground?.();
    expect(source.getToday()).toBe('2026-09-13');
    expect(listener.calls).toBe(1);

    source.dispose();
    expect(foreground).toBeUndefined();
  });

  it('does not notify after dispose', () => {
    const now = { current: new Date(2026, 8, 12, 23, 59, 50) };
    let tick: (() => void) | undefined;
    const source = createCalendarDateSource({
      clock: { now: () => now.current },
      schedule: (callback) => {
        tick = callback;
        return () => {
          tick = undefined;
        };
      },
    });
    const listener = { calls: 0 };
    source.subscribe(() => {
      listener.calls += 1;
    });
    source.dispose();
    now.current = new Date(2026, 8, 13, 0, 0, 0);
    tick?.();
    expect(listener.calls).toBe(0);
  });
});
