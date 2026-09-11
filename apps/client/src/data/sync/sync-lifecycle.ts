import type {
  CommonPowerSyncDatabase,
  PowerSyncBackendConnector,
  SyncStatus,
} from '@powersync/common';
import type { AuthRepository, AuthState } from '../repositories';

/** The slice of PowerSync status the UI may read. Tokens and SDK types stay in `src/data`. */
export interface ClientSyncStatus {
  connected: boolean;
  connecting: boolean;
  downloading: boolean;
  uploading: boolean;
}

/**
 * Observable sync status plus the upload-queue size used to block sign-out.
 * Subscribe + getStatus fit `useSyncExternalStore`; UI must not import PowerSync.
 */
export interface SyncStatusSource {
  getStatus(): ClientSyncStatus;
  subscribe(listener: () => void): () => void;
  getUploadQueueStats(): Promise<{ count: number }>;
}

type SyncDatabase = Pick<
  CommonPowerSyncDatabase,
  'connect' | 'disconnectAndClear' | 'currentStatus' | 'registerListener' | 'getUploadQueueStats'
>;

/**
 * Connects PowerSync while signed in and clears synced data on sign-out without
 * wiping `local_tasks`. Connect/clear never overlap.
 */
export function startSyncLifecycle(
  powersync: Pick<CommonPowerSyncDatabase, 'connect' | 'disconnectAndClear'>,
  auth: Pick<AuthRepository, 'getState' | 'subscribe'>,
  connector: PowerSyncBackendConnector,
): () => void {
  let lastUserId: string | null = null;
  let queue = Promise.resolve();

  function enqueue(task: () => Promise<void>) {
    queue = queue.then(task, task);
  }

  async function onSignedIn(userId: string) {
    if (lastUserId === userId) return;
    if (lastUserId != null) {
      await powersync.disconnectAndClear({ clearLocal: false });
    }
    lastUserId = userId;
    await powersync.connect(connector);
  }

  async function onSignedOut() {
    if (lastUserId == null) return;
    lastUserId = null;
    await powersync.disconnectAndClear({ clearLocal: false });
  }

  function handle(state: AuthState) {
    switch (state.status) {
      case 'signed-in':
        enqueue(() => onSignedIn(state.user.id));
        return;
      case 'signed-out':
        enqueue(() => onSignedOut());
        return;
      default:
        // restoring / restore-failed (including continue-as-guest from restore-failed)
        return;
    }
  }

  const unsubscribe = auth.subscribe(handle);
  handle(auth.getState());
  return unsubscribe;
}

export function createSyncStatusSource(powersync: SyncDatabase): SyncStatusSource {
  return {
    getStatus() {
      return toClientSyncStatus(powersync.currentStatus);
    },
    subscribe(listener) {
      return powersync.registerListener({
        statusChanged: () => listener(),
      });
    },
    async getUploadQueueStats() {
      const stats = await powersync.getUploadQueueStats();
      return { count: stats.count };
    },
  };
}

function toClientSyncStatus(status: SyncStatus): ClientSyncStatus {
  return {
    connected: status.connected,
    connecting: status.connecting,
    downloading: status.downloading,
    uploading: status.uploading,
  };
}
