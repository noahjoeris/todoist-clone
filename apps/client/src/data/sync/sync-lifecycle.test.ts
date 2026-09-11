import type { PowerSyncBackendConnector } from '@powersync/common';
import { describe, expect, it, vi } from 'vitest';
import { AuthFailure, type AuthState, type AuthUser } from '../repositories';
import { startSyncLifecycle } from './sync-lifecycle';

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

describe('startSyncLifecycle', () => {
  it('connects on signed-in and clears with clearLocal: false on signed-out', async () => {
    const powersync = {
      connect: vi.fn(async () => {}),
      disconnectAndClear: vi.fn(async () => {}),
    };
    const auth = createFakeAuth({ status: 'signed-out' });
    const stop = startSyncLifecycle(powersync, auth, connector);

    await vi.waitFor(() => expect(powersync.disconnectAndClear).not.toHaveBeenCalled());
    auth.emit({ status: 'signed-in', user: userA });
    await vi.waitFor(() => expect(powersync.connect).toHaveBeenCalledOnce());
    expect(powersync.connect).toHaveBeenCalledWith(connector);

    auth.emit({ status: 'signed-out' });
    await vi.waitFor(() => expect(powersync.disconnectAndClear).toHaveBeenCalledOnce());
    expect(powersync.disconnectAndClear).toHaveBeenCalledWith({ clearLocal: false });
    stop();
  });

  it('ignores restoring and restore-failed, including continue-as-guest', async () => {
    const powersync = {
      connect: vi.fn(async () => {}),
      disconnectAndClear: vi.fn(async () => {}),
    };
    const auth = createFakeAuth({ status: 'restoring' });
    startSyncLifecycle(powersync, auth, connector);

    auth.emit({ status: 'restore-failed', error: new AuthFailure('network') });
    auth.emit({ status: 'signed-out' });
    await Promise.resolve();
    await Promise.resolve();
    expect(powersync.connect).not.toHaveBeenCalled();
    expect(powersync.disconnectAndClear).not.toHaveBeenCalled();
  });

  it('clears then reconnects when the signed-in user changes without a sign-out', async () => {
    const order: string[] = [];
    const powersync = {
      connect: vi.fn(async () => {
        order.push('connect');
      }),
      disconnectAndClear: vi.fn(async () => {
        order.push('clear');
      }),
    };
    const auth = createFakeAuth({ status: 'signed-in', user: userA });
    startSyncLifecycle(powersync, auth, connector);
    await vi.waitFor(() => expect(powersync.connect).toHaveBeenCalledOnce());

    auth.emit({ status: 'signed-in', user: userB });
    await vi.waitFor(() => expect(powersync.connect).toHaveBeenCalledTimes(2));
    expect(order).toEqual(['connect', 'clear', 'connect']);
    expect(powersync.disconnectAndClear).toHaveBeenCalledWith({ clearLocal: false });
  });

  it('does not reconnect when the same user is emitted again', async () => {
    const powersync = {
      connect: vi.fn(async () => {}),
      disconnectAndClear: vi.fn(async () => {}),
    };
    const auth = createFakeAuth({ status: 'signed-in', user: userA });
    startSyncLifecycle(powersync, auth, connector);
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
    const powersync = {
      connect: vi.fn(async () => {
        inFlight.push('connect');
        await connectGate.promise;
        inFlight.push('connect-done');
      }),
      disconnectAndClear: vi.fn(async () => {
        inFlight.push('clear');
      }),
    };
    const auth = createFakeAuth({ status: 'signed-out' });
    startSyncLifecycle(powersync, auth, connector);

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
});
