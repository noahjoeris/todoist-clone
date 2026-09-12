import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { subscribeAppForeground } from '../app-foreground';
import { createCalendarDateSource } from '../calendar-date-source';

/** Local calendar date; refreshes at midnight and when the app returns to the foreground. */
export function useCalendarToday(): string {
  const source = useMemo(
    () => createCalendarDateSource({ onForeground: subscribeAppForeground }),
    [],
  );
  useEffect(() => () => source.dispose(), [source]);
  return useSyncExternalStore(source.subscribe, source.getToday, source.getToday);
}
