import { SEARCH_TOP_COUNT } from '../data/repositories';

export const SEARCH_DEBOUNCE_MS = 150;

export type SearchResultsStatus = 'idle' | 'loading' | 'updating' | 'ready' | 'error';

export function splitSearchSections<T>(
  tasks: readonly T[],
  topCount = SEARCH_TOP_COUNT,
): { top: T[]; rest: T[] } {
  return { top: tasks.slice(0, topCount), rest: tasks.slice(topCount) };
}

export function nextSearchSelection(
  current: number | null,
  count: number,
  direction: 1 | -1,
): number | null {
  if (count <= 0) return null;
  if (current == null) return direction === 1 ? 0 : count - 1;
  const next = current + direction;
  if (next < 0) return 0;
  if (next >= count) return count - 1;
  return next;
}

export function createQueryDebouncer(options: {
  delayMs?: number;
  onFlush: (query: string) => void;
  schedule?: (callback: () => void, delayMs: number) => () => void;
}): {
  set: (query: string) => void;
  flush: (query: string) => void;
  dispose: () => void;
} {
  const delayMs = options.delayMs ?? SEARCH_DEBOUNCE_MS;
  const schedule =
    options.schedule ??
    ((callback, delay) => {
      const handle = setTimeout(callback, delay);
      return () => clearTimeout(handle);
    });
  let cancel: (() => void) | null = null;

  function dispose() {
    cancel?.();
    cancel = null;
  }

  return {
    set(query) {
      dispose();
      cancel = schedule(() => {
        cancel = null;
        options.onFlush(query);
      }, delayMs);
    },
    flush(query) {
      dispose();
      options.onFlush(query);
    },
    dispose,
  };
}
