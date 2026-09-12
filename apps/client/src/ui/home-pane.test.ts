import { describe, expect, it } from 'vitest';
import { isSamePane, isTaskListPane, taskDestinationOf } from './home-pane';

describe('home pane', () => {
  it('treats project ids as distinct panes', () => {
    expect(
      isSamePane({ type: 'project', projectId: 'a' }, { type: 'project', projectId: 'a' }),
    ).toBe(true);
    expect(
      isSamePane({ type: 'project', projectId: 'a' }, { type: 'project', projectId: 'b' }),
    ).toBe(false);
    expect(isSamePane({ type: 'projects' }, { type: 'projects' })).toBe(true);
    expect(isSamePane({ type: 'inbox' }, { type: 'projects' })).toBe(false);
  });

  it('does not treat project views as Inbox/Today/Upcoming destinations', () => {
    expect(taskDestinationOf({ type: 'project', projectId: 'a' })).toBeNull();
    expect(taskDestinationOf({ type: 'projects' })).toBeNull();
    expect(taskDestinationOf({ type: 'inbox' })).toBe('inbox');
  });

  it('keeps management panes off the task list', () => {
    expect(isTaskListPane({ type: 'inbox' })).toBe(true);
    expect(isTaskListPane({ type: 'project', projectId: 'a' })).toBe(true);
    expect(isTaskListPane({ type: 'labels' })).toBe(false);
    expect(isTaskListPane({ type: 'projects' })).toBe(false);
  });
});
