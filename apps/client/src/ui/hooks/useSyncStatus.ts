import { useSyncExternalStore } from 'react';
import type { SyncStatusSource } from '../../data/repositories';

export type SyncIndicator = 'offline' | 'syncing' | 'synced';

const subscribeNoop = () => () => {};
const getNullSnapshot = (): null => null;

/** Maps PowerSync status to a small indicator. `sync` omitted when cloud is unconfigured. */
export function useSyncStatus(sync: SyncStatusSource | undefined): SyncIndicator | null {
  return useSyncExternalStore(
    sync ? sync.subscribe : subscribeNoop,
    sync ? () => toIndicator(sync) : getNullSnapshot,
    sync ? () => toIndicator(sync) : getNullSnapshot,
  );
}

function toIndicator(sync: SyncStatusSource): SyncIndicator {
  const status = sync.getStatus();
  if (status.connecting || status.downloading || status.uploading) return 'syncing';
  if (status.connected) return 'synced';
  return 'offline';
}
