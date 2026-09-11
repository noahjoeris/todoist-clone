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

/**
 * Which account has finished local ownership check/clear. Writes are safe for that
 * user; PowerSync connect (network) is not required.
 */
export interface LocalDataReadiness {
  userId(): string | null;
  set(userId: string | null): void;
  subscribe(listener: () => void): () => void;
}

export function createLocalDataReadiness(): LocalDataReadiness {
  let readyUserId: string | null = null;
  const listeners = new Set<() => void>();
  return {
    userId() {
      return readyUserId;
    },
    set(userId) {
      if (readyUserId === userId) return;
      readyUserId = userId;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

type LifecycleDatabase = Pick<CommonPowerSyncDatabase, 'connect' | 'disconnectAndClear'> & {
  getUploadQueueStats(): Promise<{ count: number }>;
};

type SyncDatabase = Pick<
  CommonPowerSyncDatabase,
  'connect' | 'disconnectAndClear' | 'registerListener'
> & {
  currentStatus: Pick<SyncStatus, 'connected' | 'connecting' | 'downloading' | 'uploading'>;
  getUploadQueueStats(): Promise<{ count: number }>;
};

/**
 * Connects PowerSync while signed in and clears synced data on sign-out without
 * wiping `local_tasks`. Connect/clear never overlap. The queued-data owner is
 * persisted so a crash between force-sign-out and clear cannot upload the previous
 * account's queue under a later user's JWT.
 *
 * `lastUserId` is recorded only after persist-owner and connect succeed so a failed
 * initialization stays retryable. Local-data readiness is set after the ownership
 * check/clear/persist (network connect is not required) and cleared synchronously
 * when the signed-in user changes so the UI cannot write into a queue that is about
 * to be cleared.
 */
export function startSyncLifecycle(
  powersync: LifecycleDatabase,
  auth: Pick<AuthRepository, 'getState' | 'subscribe'>,
  connectorFor: (userId: string) => PowerSyncBackendConnector,
  ownerStore: SyncOwnerStore,
  localData: LocalDataReadiness = createLocalDataReadiness(),
): () => void {
  let lastUserId: string | null = null;
  let sessionSeen = false;
  let queue = Promise.resolve();

  function enqueue(task: () => Promise<void>) {
    queue = queue.then(task, task);
  }

  async function onSignedIn(userId: string) {
    if (lastUserId === userId) return;
    const previousUserId = lastUserId;
    lastUserId = null;

    try {
      const persistedOwner = await ownerStore.get();
      if (
        await queuedDataNeedsClear({
          connectingUserId: userId,
          lastUserId: previousUserId,
          persistedOwner,
          readQueueCount: () => powersync.getUploadQueueStats().then((stats) => stats.count),
        })
      ) {
        await powersync.disconnectAndClear({ clearLocal: false });
      }

      await ownerStore.set(userId);
      localData.set(userId);
      await powersync.connect(connectorFor(userId));
      lastUserId = userId;
    } catch (error) {
      console.error('PowerSync signed-in connect failed', error);
    }
  }

  async function onSignedOut() {
    if (!sessionSeen) return;
    try {
      await powersync.disconnectAndClear({ clearLocal: false });
      await ownerStore.set(null);
      lastUserId = null;
      if (auth.getState().status !== 'signed-in') sessionSeen = false;
    } catch (error) {
      console.error('PowerSync signed-out clear failed', error);
    }
  }

  function handle(state: AuthState) {
    switch (state.status) {
      case 'signed-in':
        if (localData.userId() !== state.user.id) localData.set(null);
        sessionSeen = true;
        enqueue(() => onSignedIn(state.user.id));
        return;
      case 'signed-out':
        localData.set(null);
        if (!sessionSeen) return;
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

export function createSyncStatusSource(
  powersync: SyncDatabase,
  localData: LocalDataReadiness,
): SyncStatusSource {
  return {
    getStatus() {
      return toClientSyncStatus(powersync.currentStatus);
    },
    isLocalDataReadyFor(userId) {
      return localData.userId() === userId;
    },
    subscribe(listener) {
      const stopStatus = powersync.registerListener({
        statusChanged: () => listener(),
      });
      const stopReady = localData.subscribe(listener);
      return () => {
        stopStatus();
        stopReady();
      };
    },
    async getUploadQueueStats() {
      const stats = await powersync.getUploadQueueStats();
      return { count: stats.count };
    },
  };
}

function toClientSyncStatus(
  status: Pick<SyncStatus, 'connected' | 'connecting' | 'downloading' | 'uploading'>,
): ClientSyncStatus {
  return {
    connected: status.connected,
    connecting: status.connecting,
    downloading: status.downloading,
    uploading: status.uploading,
  };
}
