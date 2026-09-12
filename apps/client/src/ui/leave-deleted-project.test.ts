import { describe, expect, it, vi } from 'vitest';
import { confirmLeaveDeletedProject } from './leave-deleted-project';

describe('confirmLeaveDeletedProject', () => {
  it('leaves without prompting when the composer is clean', async () => {
    const confirmDiscard = vi.fn(async () => false);
    await expect(confirmLeaveDeletedProject({ isDirty: false, confirmDiscard })).resolves.toBe(
      'leave',
    );
    expect(confirmDiscard).not.toHaveBeenCalled();
  });

  it('stays when the composer is dirty and discard is declined', async () => {
    await expect(
      confirmLeaveDeletedProject({ isDirty: true, confirmDiscard: async () => false }),
    ).resolves.toBe('stay');
  });

  it('leaves when the composer is dirty and discard is confirmed', async () => {
    await expect(
      confirmLeaveDeletedProject({ isDirty: true, confirmDiscard: async () => true }),
    ).resolves.toBe('leave');
  });
});
