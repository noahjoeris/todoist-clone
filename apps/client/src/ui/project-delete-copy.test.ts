import { describe, expect, it } from 'vitest';
import { deleteProjectMessage } from './project-delete-copy';

describe('project delete copy', () => {
  it('reports total affected tasks, including completed, not the active count', () => {
    expect(deleteProjectMessage('Work', 0)).toBe('Delete “Work”? It has no tasks.');
    expect(deleteProjectMessage('Work', 1)).toBe(
      'Delete “Work”? 1 task will move to Inbox, including completed tasks. None of the tasks will be deleted.',
    );
    expect(deleteProjectMessage('Work', 3)).toBe(
      'Delete “Work”? 3 tasks will move to Inbox, including completed tasks. None of the tasks will be deleted.',
    );
  });
});
