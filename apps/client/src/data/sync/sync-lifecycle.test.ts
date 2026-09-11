import type { PowerSyncBackendConnector } from '@powersync/common';
import { describe, expect, it, vi } from 'vitest';
import { AuthFailure, type AuthState, type AuthUser } from '../repositories';
import { type SyncOwnerStore, shouldClearQueuedData, startSyncLifecycle } from './sync-lifecycle';

const userA: AuthUser = { id: 'user-a', email: 'a@example.com' };
const userB: AuthUser = { id: 'user-b', email: 'b@example.com' };
const connector = {} as PowerSyncBackendConnector;

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createFakeAuth(initial: AuthState) {
  let state = initial;
  const listeners = new Set<(next: AuthState) => void>();
  return {
    getState: () => state,
    subscribe(listener: (next: AuthState) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(next: AuthState) {
      state = next;
      for (const listener of listeners) listener(state);
    },
  };
}

function memoryOwnerStore(
  initial: string | null = null,
): SyncOwnerStore & { owner: string | null } {
  const store = {
    owner: initial,
    async get() {
      return store.owner;
    },
    async set(userId: string | null) {
      store.owner = userId;
    },
  };
  return store;
}

function createFakePowerSync(queueCount = 0) {
  return {
    connect: vi.fn(async () => {}),
    disconnectAndClear: vi.fn(async () => {}),
    getUploadQueueStats: vi.fn(async () => ({ count: queueCount })),
  };
}

describe('shouldClearQueuedData', () => {
  it('does not clear when this process is already connected as the same user', () => {
    expect(
      shouldClearQueuedData({
        connectingUserId: 'user-a',
        lastUserId: 'user-a',
        persistedOwner: 'user-b',
        queueCount: 3,
      }),
    ).toBe(false);
  });

  it('clears when the persisted owner is a different account', () => {
    expect(
      shouldClearQueuedData({
        connectingUserId: 'user-b',
        lastUserId: null,
        persistedOwner: 'user-a',
        queueCount: 0,
      }),
    ).toBe(true);
  });

  it('keeps the queue when reconnecting the persisted owner', () => {
    expect(
      shouldClearQueuedData({
        connectingUserId: 'user-a',
        lastUserId: null,
        persistedOwner: 'user-a',
        queueCount: 4,
      }),
    ).toBe(false);
  });

  it('clears an unknown-owner queue, including when the count cannot be read', () => {
    expect(
      shouldClearQueuedData({
        connectingUserId: 'user-a',
        lastUserId: null,
        persistedOwner: null,
        queueCount: 2,
      }),
    ).toBe(true);
    expect(
      shouldClearQueuedData({
        connectingUserId: 'user-a',
        lastUserId: null,
        persistedOwner: null,
        queueCount: null,
      }),
    ).toBe(true);
  });

  it('does not clear a first-time connect with an empty queue', () => {
    expect(
      shouldClearQueuedData({
        connectingUserId: 'user-a',
        lastUserId: null,
        persistedOwner: null,
        queueCount: 0,
      }),
    ).toBe(false);
  });
});

describe('startSyncLifecycle', () => {
  it('connects on signed-in and clears with clearLocal: false on signed-out', async () => {
    const powersync = createFakePowerSync();
    const auth = createFakeAuth({ status: 'signed-out' });
    const store = memoryOwnerStore();
    const stop = startSyncLifecycle(powersync, auth, connector, store);

    await vi.waitFor(() => expect(powersync.disconnectAndClear).not.toHaveBeenCalled());
    auth.emit({ status: 'signed-in', user: userA });
    await vi.waitFor(() => expect(powersync.connect).toHaveBeenCalledOnce());
    expect(powersync.connect).toHaveBeenCalledWith(connector);
    expect(store.owner).toBe(userA.id);

    auth.emit({ status: 'signed-out' });
    await vi.waitFor(() => expect(powersync.disconnectAndClear).toHaveBeenCalledOnce());
    expect(powersync.disconnectAndClear).toHaveBeenCalledWith({ clearLocal: false });
    expect(store.owner).toBeNull();
    stop();
  });

  it('ignores restoring and restore-failed, including continue-as-guest', async () => {
    const powersync = createFakePowerSync();
    const auth = createFakeAuth({ status: 'restoring' });
    startSyncLifecycle(powersync, auth, connector, memoryOwnerStore());

    auth.emit({ status: 'restore-failed', error: new AuthFailure('network') });
    auth.emit({ status: 'signed-out' });
    await Promise.resolve();
    await Promise.resolve();
    expect(powersync.connect).not.toHaveBeenCalled();
    expect(powersync.disconnectAndClear).not.toHaveBeenCalled();
  });

  it('clears then reconnects when the signed-in user changes without a sign-out', async () => {
    const order: string[] = [];
    const powersync = createFakePowerSync();
    powersync.connect.mockImplementation(async () => {
      order.push('connect');
    });
    powersync.disconnectAndClear.mockImplementation(async () => {
      order.push('clear');
    });
    const auth = createFakeAuth({ status: 'signed-in', user: userA });
    startSyncLifecycle(powersync, auth, connector, memoryOwnerStore());
    await vi.waitFor(() => expect(powersync.connect).toHaveBeenCalledOnce());

    auth.emit({ status: 'signed-in', user: userB });
    await vi.waitFor(() => expect(powersync.connect).toHaveBeenCalledTimes(2));
    expect(order).toEqual(['connect', 'clear', 'connect']);
    expect(powersync.disconnectAndClear).toHaveBeenCalledWith({ clearLocal: false });
  });

  it('does not reconnect when the same user is emitted again', async () => {
    const powersync = createFakePowerSync();
    const auth = createFakeAuth({ status: 'signed-in', user: userA });
    startSyncLifecycle(powersync, auth, connector, memoryOwnerStore());
    await vi.waitFor(() => expect(powersync.connect).toHaveBeenCalledOnce());

    auth.emit({ status: 'signed-in', user: userA });
    await Promise.resolve();
    await Promise.resolve();
    expect(powersync.connect).toHaveBeenCalledOnce();
    expect(powersync.disconnectAndClear).not.toHaveBeenCalled();
  });

  it('serializes connect and clear so they never overlap', async () => {
    const connectGate = deferred();
    const inFlight: string[] = [];
    const powersync = createFakePowerSync();
    powersync.connect.mockImplementation(async () => {
      inFlight.push('connect');
      await connectGate.promise;
      inFlight.push('connect-done');
    });
    powersync.disconnectAndClear.mockImplementation(async () => {
      inFlight.push('clear');
    });
    const auth = createFakeAuth({ status: 'signed-out' });
    startSyncLifecycle(powersync, auth, connector, memoryOwnerStore());

    auth.emit({ status: 'signed-in', user: userA });
    await vi.waitFor(() => expect(inFlight).toEqual(['connect']));
    auth.emit({ status: 'signed-out' });
    await Promise.resolve();
    expect(inFlight).toEqual(['connect']);
    expect(powersync.disconnectAndClear).not.toHaveBeenCalled();

    connectGate.resolve();
    await vi.waitFor(() => expect(powersync.disconnectAndClear).toHaveBeenCalledOnce());
    expect(inFlight).toEqual(['connect', 'connect-done', 'clear']);
  });

  it('clears leftover uploads when a different account signs in after a crashed discard', async () => {
    const order: string[] = [];
    const powersync = createFakePowerSync(3);
    powersync.connect.mockImplementation(async () => {
      order.push('connect');
    });
    powersync.disconnectAndClear.mockImplementation(async () => {
      order.push('clear');
    });
    const store = memoryOwnerStore(userA.id);
    const auth = createFakeAuth({ status: 'signed-out' });
    startSyncLifecycle(powersync, auth, connector, store);

    auth.emit({ status: 'signed-in', user: userB });
    await vi.waitFor(() => expect(powersync.connect).toHaveBeenCalledOnce());
    expect(order).toEqual(['clear', 'connect']);
    expect(powersync.disconnectAndClear).toHaveBeenCalledWith({ clearLocal: false });
    expect(store.owner).toBe(userB.id);
  });

  it('clears an unknown-owner queue before the first connect', async () => {
    const powersync = createFakePowerSync(2);
    const store = memoryOwnerStore(null);
    const auth = createFakeAuth({ status: 'signed-in', user: userA });
    startSyncLifecycle(powersync, auth, connector, store);

    await vi.waitFor(() => expect(powersync.connect).toHaveBeenCalledOnce());
    expect(powersync.disconnectAndClear).toHaveBeenCalledOnce();
    expect(store.owner).toBe(userA.id);
  });

  it('does not inspect the queue when the persisted owner already mismatches', async () => {
    const powersync = createFakePowerSync(3);
    const auth = createFakeAuth({ status: 'signed-in', user: userB });
    startSyncLifecycle(powersync, auth, connector, memoryOwnerStore(userA.id));

    await vi.waitFor(() => expect(powersync.connect).toHaveBeenCalledOnce());
    expect(powersync.disconnectAndClear).toHaveBeenCalledOnce();
    expect(powersync.getUploadQueueStats).not.toHaveBeenCalled();
  });

  it('reconnects the persisted owner without clearing their queue', async () => {
    const powersync = createFakePowerSync(4);
    const store = memoryOwnerStore(userA.id);
    const auth = createFakeAuth({ status: 'signed-in', user: userA });
    startSyncLifecycle(powersync, auth, connector, store);

    await vi.waitFor(() => expect(powersync.connect).toHaveBeenCalledOnce());
    expect(powersync.disconnectAndClear).not.toHaveBeenCalled();
    expect(store.owner).toBe(userA.id);
  });

  it('clears when the queue size cannot be read for an unknown owner', async () => {
    const powersync = createFakePowerSync();
    powersync.getUploadQueueStats.mockRejectedValue(new Error('queue unavailable'));
    const auth = createFakeAuth({ status: 'signed-in', user: userA });
    startSyncLifecycle(powersync, auth, connector, memoryOwnerStore());

    await vi.waitFor(() => expect(powersync.connect).toHaveBeenCalledOnce());
    expect(powersync.disconnectAndClear).toHaveBeenCalledOnce();
  });

  it('persists the owner before connect so a crash still records who queued data', async () => {
    const order: string[] = [];
    const powersync = createFakePowerSync();
    const store = memoryOwnerStore();
    const originalSet = store.set.bind(store);
    store.set = async (userId) => {
      order.push(`persist:${userId}`);
      await originalSet(userId);
    };
    powersync.connect.mockImplementation(async () => {
      order.push('connect');
    });
    const auth = createFakeAuth({ status: 'signed-in', user: userA });
    startSyncLifecycle(powersync, auth, connector, store);

    await vi.waitFor(() => expect(powersync.connect).toHaveBeenCalledOnce());
    expect(order).toEqual(['persist:user-a', 'connect']);
  });
});
