import { useSyncExternalStore } from 'react';
import type { GuestTaskAdoptionRepository, GuestTaskAdoptionState } from '../../data/repositories';

/** Live guest-task adoption offer. Hidden until guest rows exist and the prompt is not skipped. */
export function useGuestTaskAdoption(
  repository: GuestTaskAdoptionRepository,
): GuestTaskAdoptionState {
  return useSyncExternalStore(repository.subscribe, repository.getState, repository.getState);
}
