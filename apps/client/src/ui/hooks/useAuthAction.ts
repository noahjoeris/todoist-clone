import { useRef, useState } from 'react';
import { AuthFailure } from '../../data/repositories';

/**
 * Runs one auth operation at a time for a form: ignores duplicate submissions while pending
 * and keeps the last failure for inline display.
 */
export function useAuthAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AuthFailure | null>(null);
  const running = useRef(false);

  async function run(action: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(
        cause instanceof AuthFailure ? cause : new AuthFailure('unknown', undefined, { cause }),
      );
    } finally {
      running.current = false;
      setPending(false);
    }
  }

  return { pending, error, run, clearError: () => setError(null) };
}
