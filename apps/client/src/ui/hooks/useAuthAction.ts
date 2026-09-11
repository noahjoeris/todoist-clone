import { AuthFailure } from '../../data/repositories';
import { useAsyncAction } from './useAsyncAction';

/**
 * Runs one auth operation at a time for a form: ignores duplicate submissions while pending
 * and keeps the last failure for inline display.
 */
export function useAuthAction() {
  return useAsyncAction((cause) =>
    cause instanceof AuthFailure ? cause : new AuthFailure('unknown', undefined, { cause }),
  );
}
