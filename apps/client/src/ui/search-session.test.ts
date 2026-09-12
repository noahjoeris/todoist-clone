import { describe, expect, it, vi } from 'vitest';
import type { TaskSearchSnapshot } from '../data/repositories';
import {
  createQueryDebouncer,
  EMPTY_SEARCH_SNAPSHOT,
  nextSearchSelection,
  runRecentSearchMutation,
  splitSearchSections,
  visibleSearchResults,
} from './search-session';

describe('search result sections', () => {
  it('puts up to five tasks in Top and the remainder in Tasks without duplicates', () => {
    const tasks = [1, 2, 3, 4, 5, 6, 7];
    expect(splitSearchSections(tasks)).toEqual({ top: [1, 2, 3, 4, 5], rest: [6, 7] });
    expect(splitSearchSections([1, 2])).toEqual({ top: [1, 2], rest: [] });
    expect(splitSearchSections([])).toEqual({ top: [], rest: [] });
  });
});

describe('search keyboard selection', () => {
  it('starts from the end matching the arrow and clamps to the list', () => {
    expect(nextSearchSelection(null, 0, 1)).toBeNull();
    expect(nextSearchSelection(null, 3, 1)).toBe(0);
    expect(nextSearchSelection(null, 3, -1)).toBe(2);
    expect(nextSearchSelection(0, 3, -1)).toBe(0);
    expect(nextSearchSelection(2, 3, 1)).toBe(2);
    expect(nextSearchSelection(1, 3, 1)).toBe(2);
  });
});

describe('search query debounce', () => {
  it('flushes after the delay and cancels a pending change', () => {
    vi.useFakeTimers();
    const onFlush = vi.fn();
    const debouncer = createQueryDebouncer({ delayMs: 150, onFlush });
    debouncer.set('a');
    debouncer.set('ab');
    vi.advanceTimersByTime(149);
    expect(onFlush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onFlush).toHaveBeenCalledOnce();
    expect(onFlush).toHaveBeenCalledWith('ab');
    debouncer.flush('abc');
    expect(onFlush).toHaveBeenCalledTimes(2);
    expect(onFlush).toHaveBeenLastCalledWith('abc');
    debouncer.set('stale');
    debouncer.dispose();
    vi.advanceTimersByTime(150);
    expect(onFlush).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe('visible search results while replacing a query', () => {
  const snapshot = { tasks: [{ id: 'old' }], hasMore: false } as TaskSearchSnapshot;

  it('hides hits while the input has not flushed', () => {
    expect(
      visibleSearchResults({
        input: 'eggs',
        activeQuery: 'milk',
        snapshotQuery: 'milk',
        snapshot,
        status: 'ready',
      }),
    ).toEqual({ snapshot: EMPTY_SEARCH_SNAPSHOT, status: 'loading', queryPending: true });
  });

  it('hides prior hits after flush until the replacement snapshot arrives', () => {
    expect(
      visibleSearchResults({
        input: 'eggs',
        activeQuery: 'eggs',
        snapshotQuery: 'milk',
        snapshot,
        status: 'ready',
      }),
    ).toEqual({ snapshot: EMPTY_SEARCH_SNAPSHOT, status: 'loading', queryPending: true });
  });

  it('shows hits once the snapshot belongs to the active query', () => {
    expect(
      visibleSearchResults({
        input: 'eggs',
        activeQuery: 'eggs',
        snapshotQuery: 'eggs',
        snapshot,
        status: 'ready',
      }),
    ).toEqual({ snapshot, status: 'ready', queryPending: false });
  });

  it('keeps current hits while the same query is updating', () => {
    expect(
      visibleSearchResults({
        input: 'milk',
        activeQuery: 'milk',
        snapshotQuery: 'milk',
        snapshot,
        status: 'updating',
      }),
    ).toEqual({ snapshot, status: 'updating', queryPending: false });
  });
});

describe('recent search mutations', () => {
  it('reports rejections instead of leaving them unhandled', async () => {
    const onError = vi.fn();
    const onSuccess = vi.fn();
    await runRecentSearchMutation(() => Promise.reject(new Error('disk')), onError, onSuccess);
    expect(onError).toHaveBeenCalledOnce();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('clears the failure after a successful write', async () => {
    const onError = vi.fn();
    const onSuccess = vi.fn();
    await runRecentSearchMutation(() => Promise.resolve(), onError, onSuccess);
    expect(onError).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledOnce();
  });
});
