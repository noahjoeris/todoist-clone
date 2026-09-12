import { describe, expect, it } from 'vitest';
import { deleteMessage } from './label-delete-copy';

describe('label delete copy', () => {
  it('reports total affected tasks, including completed, not the active count', () => {
    expect(deleteMessage('Work', 0)).toBe('Delete “Work”? It is not on any tasks.');
    expect(deleteMessage('Work', 1)).toBe(
      'Delete “Work”? It will be removed from 1 task, including completed ones. Tasks themselves will not be deleted.',
    );
    expect(deleteMessage('Work', 3)).toBe(
      'Delete “Work”? It will be removed from 3 tasks, including completed ones. Tasks themselves will not be deleted.',
    );
  });
});
