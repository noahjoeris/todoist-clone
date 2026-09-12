import { describe, expect, it, vi } from 'vitest';
import { type Task, TaskRestoreConflictError } from '../data/repositories';
import { createTaskUndoController, TASK_UNDO_TTL_MS } from './task-undo';

const TASK_A: Task = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  title: 'First',
  description: '',
  priority: 4,
  scheduledDate: null,
  scheduledTime: null,
  completedAt: null,
  createdAt: '2026-09-10T08:00:00.000Z',
  labels: [],
  projectId: null,
  project: null,
};

const TASK_B: Task = {
  ...TASK_A,
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  title: 'Second',
};

describe('task undo controller', () => {
  it('expires the latest deletion without restoring', () => {
    vi.useFakeTimers();
    const restore = vi.fn(async () => {});
    const controller = createTaskUndoController({ restore });

    controller.offer(TASK_A);
    expect(controller.getState()).toEqual({ task: TASK_A });

    vi.advanceTimersByTime(TASK_UNDO_TTL_MS - 1);
    expect(controller.getState()).toEqual({ task: TASK_A });

    vi.advanceTimersByTime(1);
    expect(controller.getState()).toBeNull();
    expect(restore).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('replaces a previous deletion so only the latest can be undone', () => {
    vi.useFakeTimers();
    const restore = vi.fn(async () => {});
    const controller = createTaskUndoController({ restore });

    controller.offer(TASK_A);
    vi.advanceTimersByTime(3_000);
    controller.offer(TASK_B);
    expect(controller.getState()).toEqual({ task: TASK_B });

    vi.advanceTimersByTime(TASK_UNDO_TTL_MS - 1);
    expect(controller.getState()).toEqual({ task: TASK_B });
    vi.advanceTimersByTime(1);
    expect(controller.getState()).toBeNull();
    expect(restore).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('restores the snapshot on undo and then clears', async () => {
    vi.useFakeTimers();
    const restore = vi.fn(async () => {});
    const controller = createTaskUndoController({ restore });
    controller.offer(TASK_A);

    await controller.undo();
    expect(restore).toHaveBeenCalledOnce();
    expect(restore).toHaveBeenCalledWith(TASK_A);
    expect(controller.getState()).toBeNull();

    vi.advanceTimersByTime(TASK_UNDO_TTL_MS);
    expect(restore).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('keeps Undo until expiry when restore refuses an existing id', async () => {
    vi.useFakeTimers();
    const restore = vi.fn(async () => {
      throw new TaskRestoreConflictError();
    });
    const controller = createTaskUndoController({ restore });
    controller.offer(TASK_A);

    await expect(controller.undo()).rejects.toBeInstanceOf(TaskRestoreConflictError);
    expect(controller.getState()).toEqual({ task: TASK_A });

    vi.advanceTimersByTime(TASK_UNDO_TTL_MS);
    expect(controller.getState()).toBeNull();
    vi.useRealTimers();
  });

  it('dismisses on account switch without restoring', () => {
    vi.useFakeTimers();
    const restore = vi.fn(async () => {});
    const controller = createTaskUndoController({ restore });
    controller.offer(TASK_A);

    controller.dismiss();
    expect(controller.getState()).toBeNull();
    expect(restore).not.toHaveBeenCalled();

    vi.advanceTimersByTime(TASK_UNDO_TTL_MS);
    expect(restore).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
