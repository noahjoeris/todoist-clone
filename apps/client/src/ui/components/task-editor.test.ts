import { describe, expect, it } from 'vitest';
import { labelIdsForSubmit } from '../../data/repositories/label-associations';
import {
  holdOpenEditorLabelIds,
  labelIdsFromTask,
  projectIdFromTask,
  resolveOpenEditorTask,
} from './task-editor';

const task = (ids: string[]) => ({ labels: ids.map((id) => ({ id })) });

describe('open-editor label baseline', () => {
  it('reads label ids from the task, or an empty list when missing', () => {
    expect(labelIdsFromTask(task(['a', 'b']))).toEqual(['a', 'b']);
    expect(labelIdsFromTask(null)).toEqual([]);
  });

  it('keeps the mount-time ids when a remote removal arrives', () => {
    const held = holdOpenEditorLabelIds(undefined, task(['a']));
    expect(holdOpenEditorLabelIds(held, task([]))).toEqual(['a']);
  });

  it('keeps the mount-time ids when a remote add arrives', () => {
    const held = holdOpenEditorLabelIds(undefined, task(['a']));
    expect(holdOpenEditorLabelIds(held, task(['a', 'b']))).toEqual(['a']);
  });

  it('omits labels from a title-only save after a remote removal', () => {
    const held = holdOpenEditorLabelIds(undefined, task(['a']));
    const baseline = holdOpenEditorLabelIds(held, task([]));
    expect(labelIdsForSubmit(baseline, baseline, 'when-changed')).toBeUndefined();
  });
});

describe('open-editor project baseline', () => {
  it('reads Inbox as null and keeps the mount-time project id', () => {
    expect(projectIdFromTask(null)).toBeNull();
    expect(projectIdFromTask({ projectId: null })).toBeNull();
    expect(projectIdFromTask({ projectId: 'p1' })).toBe('p1');
  });
});

describe('open-editor task identity', () => {
  const inbox = { id: 't1', projectId: null as string | null };
  const inProject = { id: 't1', projectId: 'p1' };

  it('does not treat a membership change as missing', () => {
    expect(
      resolveOpenEditorTask({
        editingId: 't1',
        viewTask: null,
        watched: { id: 't1', task: inProject },
        heldTask: inbox,
      }),
    ).toEqual({ task: inProject, missing: false, hold: inProject });
  });

  it('treats a by-id miss as missing while keeping the last snapshot', () => {
    expect(
      resolveOpenEditorTask({
        editingId: 't1',
        viewTask: null,
        watched: { id: 't1', task: null },
        heldTask: inbox,
      }),
    ).toEqual({ task: inbox, missing: true, hold: inbox });
  });

  it('holds the view snapshot until the by-id watch for this id arrives', () => {
    expect(
      resolveOpenEditorTask({
        editingId: 't1',
        viewTask: null,
        watched: { id: 't0', task: null },
        heldTask: inbox,
      }),
    ).toEqual({ task: inbox, missing: false, hold: inbox });
  });
});
