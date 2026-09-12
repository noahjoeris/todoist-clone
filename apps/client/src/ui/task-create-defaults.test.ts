import { describe, expect, it } from 'vitest';
import { defaultComposerLabelIds, defaultComposerProjectId } from './task-create-defaults';

describe('task create defaults', () => {
  it('uses the active project only when adding from that project view', () => {
    expect(defaultComposerProjectId('view', { type: 'project', projectId: 'p1' })).toBe('p1');
    expect(defaultComposerProjectId('global', { type: 'project', projectId: 'p1' })).toBeNull();
    expect(defaultComposerProjectId('view', { type: 'inbox' })).toBeNull();
    expect(defaultComposerProjectId('view', { type: 'today' })).toBeNull();
    expect(defaultComposerProjectId('view', { type: 'label', labelId: 'l1' })).toBeNull();
    expect(defaultComposerProjectId('group', { type: 'upcoming' })).toBeNull();
  });

  it('keeps label defaults independent of project membership', () => {
    expect(defaultComposerLabelIds('view', { type: 'label', labelId: 'l1' })).toEqual(['l1']);
    expect(defaultComposerLabelIds('global', { type: 'label', labelId: 'l1' })).toBeUndefined();
    expect(defaultComposerLabelIds('view', { type: 'project', projectId: 'p1' })).toBeUndefined();
  });
});
