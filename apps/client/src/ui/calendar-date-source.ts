import { millisecondsUntilLocalMidnight, toCalendarDate } from './components/task-date';

export interface Clock {
  now(): Date;
}

export interface CalendarDateSource {
  getToday(): string;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

/**
 * Local calendar date that refreshes at midnight and when the app returns to the
 * foreground. Inject `clock` and `schedule` in tests.
 */
export function createCalendarDateSource(options?: {
  clock?: Clock;
  schedule?: (callback: () => void, delayMs: number) => () => void;
  onForeground?: (listener: () => void) => () => void;
}): CalendarDateSource {
  const clock = options?.clock ?? { now: () => new Date() };
  const schedule =
    options?.schedule ??
    ((callback, delayMs) => {
      const handle = setTimeout(callback, delayMs);
      return () => clearTimeout(handle);
    });

  const listeners = new Set<() => void>();
  let today = toCalendarDate(clock.now());
  let cancelMidnight: (() => void) | null = null;
  let stopForeground: (() => void) | null = null;
  let disposed = false;

  function notifyIfChanged() {
    if (disposed) return;
    const next = toCalendarDate(clock.now());
    if (next !== today) {
      today = next;
      for (const listener of listeners) listener();
    }
    armMidnight();
  }

  function armMidnight() {
    cancelMidnight?.();
    cancelMidnight = null;
    if (disposed) return;
    cancelMidnight = schedule(notifyIfChanged, millisecondsUntilLocalMidnight(clock.now()));
  }

  armMidnight();
  if (options?.onForeground) {
    stopForeground = options.onForeground(notifyIfChanged);
  }

  return {
    getToday: () => today,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      disposed = true;
      cancelMidnight?.();
      cancelMidnight = null;
      stopForeground?.();
      stopForeground = null;
      listeners.clear();
    },
  };
}
