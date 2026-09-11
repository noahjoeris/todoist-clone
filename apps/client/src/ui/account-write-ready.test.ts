import { describe, expect, it } from 'vitest';
import { canWriteAccountTasks } from './account-write-ready';

describe('canWriteAccountTasks', () => {
  it('blocks writes until local data is ready for the signed-in account', () => {
    const sync = { isLocalDataReadyFor: (userId: string) => userId === 'user-a' };
    expect(canWriteAccountTasks(null, sync)).toBe(false);
    expect(canWriteAccountTasks('user-a', { isLocalDataReadyFor: () => false })).toBe(false);
    expect(canWriteAccountTasks('user-b', sync)).toBe(false);
    expect(canWriteAccountTasks('user-a', sync)).toBe(true);
  });
});
