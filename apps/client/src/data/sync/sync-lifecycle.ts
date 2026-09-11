import type {
  CommonPowerSyncDatabase,
  PowerSyncBackendConnector,
  SyncStatus,
} from '@powersync/common';
import type {
  AuthRepository,
  AuthState,
  ClientSyncStatus,
  SyncStatusSource,
} from '../repositories';

/** Persists which account owns leftover upload-queue rows across process restarts. */
export interface SyncOwnerStore {
  get(): Promise<string | null>;
  set(userId: string | null): Promise<void>;
}

type LifecycleDatabase = Pick<CommonPowerSyncDatabase, 'connect' | 'disconnectAndClear'> & {
  getUploadQueueStats(): Promise<{ count: number }>;
};

type SyncDatabase = Pick<
  CommonPowerSyncDatabase,
  'connect' | 'disconnectAndClear' | 'currentStatus' | 'registerListener' | 'getUploadQueueStats'
>;

/**
 * Connects PowerSync while signed in and clears synced data on sign-out without
 * wiping `local_tasks`. Connect/clear never overlap. The queued-data owner is
 * persisted so a crash between force-sign-out and clear cannot upload the previous
 * account's queue under a later user's JWT.
 */
export function startSyncLifecycle(
  powersync: LifecycleDatabase,
  auth: Pick<AuthRepository, 'getState' | 'subscribe'>,
  connector: PowerSyncBackendConnector,
  ownerStore: SyncOwnerStore,
): () => void {
  let lastUserId: string | null = null;
  let queue = Promise.resolve();

  function enqueue(task: () => Promise<void>) {
    queue = queue.then(task, task);
  }

  async function onSignedIn(userId: string) {
    if (lastUserId === userId) return;

    const persistedOwner = await ownerStore.get();
    if (
      await queuedDataNeedsClear({
        connectingUserId: userId,
        lastUserId,
        persistedOwner,
        readQueueCount: () => powersync.getUploadQueueStats().then((stats) => stats.count),
      })
    ) {
      await powersync.disconnectAndClear({ clearLocal: false });
    }

    lastUserId = userId;
    await ownerStore.set(userId);
    await powersync.connect(connector);
  }

  async function onSignedOut() {
    if (lastUserId == null) return;
    lastUserId = null;
    await powersync.disconnectAndClear({ clearLocal: false });
    await ownerStore.set(null);
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

/**
 * True when connecting would upload rows that belong to a different (or unknown)
 * account. `queueCount` is `null` when the queue could not be read — fail closed.
 */
export function shouldClearQueuedData(input: {
  connectingUserId: string;
  lastUserId: string | null;
  persistedOwner: string | null;
  queueCount: number | null;
}): boolean {
  if (input.lastUserId === input.connectingUserId) return false;
  const owner = input.lastUserId ?? input.persistedOwner;
  if (owner != null) return owner !== input.connectingUserId;
  return input.queueCount !== 0;
}

async function queuedDataNeedsClear(input: {
  connectingUserId: string;
  lastUserId: string | null;
  persistedOwner: string | null;
  readQueueCount: () => Promise<number>;
}): Promise<boolean> {
  const owner = input.lastUserId ?? input.persistedOwner;
  let queueCount: number | null = 0;
  if (owner == null) {
    try {
      queueCount = await input.readQueueCount();
    } catch {
      queueCount = null;
    }
  }
  return shouldClearQueuedData({
    connectingUserId: input.connectingUserId,
    lastUserId: input.lastUserId,
    persistedOwner: input.persistedOwner,
    queueCount,
  });
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
