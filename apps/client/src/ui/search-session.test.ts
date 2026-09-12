import { describe, expect, it, vi } from 'vitest';
import { createQueryDebouncer, nextSearchSelection, splitSearchSections } from './search-session';

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
