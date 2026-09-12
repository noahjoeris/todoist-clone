import { describe, expect, it } from 'vitest';
import { labelIdsForSubmit } from '../../data/repositories/label-associations';
import { holdOpenEditorLabelIds, labelIdsFromTask, projectIdFromTask } from './task-editor';

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
