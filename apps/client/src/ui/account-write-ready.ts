import type { SyncStatusSource } from '../data/repositories';

/** Account writes wait until this user's local ownership check/clear has finished. */
export function canWriteAccountTasks(
  signedInUserId: string | null,
  sync: Pick<SyncStatusSource, 'isLocalDataReadyFor'>,
): boolean {
  return signedInUserId != null && sync.isLocalDataReadyFor(signedInUserId);
}
