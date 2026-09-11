import type { Task } from '../data/repositories';

export const TASK_UNDO_TTL_MS = 8_000;

export interface TaskUndoState {
  task: Task;
}

export interface TaskUndoController {
  getState(): TaskUndoState | null;
  subscribe(listener: () => void): () => void;
  offer(task: Task): void;
  undo(): Promise<void>;
  dismiss(): void;
}

/**
 * Session-scoped undo for the latest deletion. No persistence: leaving the
 * session or restarting dismisses without restoring.
 */
export function createTaskUndoController(options: {
  restore: (task: Task) => Promise<void>;
  ttlMs?: number;
  schedule?: (callback: () => void, delayMs: number) => () => void;
}): TaskUndoController {
  const ttlMs = options.ttlMs ?? TASK_UNDO_TTL_MS;
  const schedule =
    options.schedule ??
    ((callback, delayMs) => {
      const handle = setTimeout(callback, delayMs);
      return () => clearTimeout(handle);
    });

  const listeners = new Set<() => void>();
  let snapshot: TaskUndoState | null = null;
  let cancelTimer: (() => void) | null = null;

  function notify() {
    for (const listener of listeners) listener();
  }

  function dismiss() {
    cancelTimer?.();
    cancelTimer = null;
    if (snapshot === null) return;
    snapshot = null;
    notify();
  }

  return {
    getState: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    offer(task) {
      cancelTimer?.();
      snapshot = { task };
      cancelTimer = schedule(() => {
        snapshot = null;
        cancelTimer = null;
        notify();
      }, ttlMs);
      notify();
    },
    async undo() {
      if (snapshot === null) return;
      await options.restore(snapshot.task);
      dismiss();
    },
    dismiss,
  };
}
