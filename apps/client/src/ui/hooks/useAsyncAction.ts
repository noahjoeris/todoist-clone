import { useRef, useState } from 'react';

/**
 * Runs one async action at a time: ignores duplicate submissions while pending
 * and keeps the last mapped failure for inline display.
 */
export function useAsyncAction<E>(mapError: (cause: unknown) => E) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<E | null>(null);
  const running = useRef(false);

  async function run(action: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(mapError(cause));
    } finally {
      running.current = false;
      setPending(false);
    }
  }

  return { pending, error, run, clearError: () => setError(null) };
}
