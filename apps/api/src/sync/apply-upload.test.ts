import { describe, expect, it, vi } from 'vitest';
import { applyUpload, InvalidRequestError } from './apply-upload.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function selectChain(rows: unknown[]) {
  const forFn = vi.fn();
  const chain = Object.assign(Promise.resolve(rows), {
    from: () => chain,
    where: () => chain,
    limit: () => chain,
    for: (...args: unknown[]) => {
      forFn(...args);
      return chain;
    },
  });
  return { chain, forFn };
}

function updateChain(rows: unknown[]) {
  const chain = {
    set: () => chain,
    where: () => chain,
    returning: () => Promise.resolve(rows),
  };
  return chain;
}

describe('applyUpload schedule merge', () => {
  it('locks the row with FOR UPDATE before merging a schedule PATCH', async () => {
    const { chain, forFn } = selectChain([
      { userId: USER_ID, scheduledDate: '2026-09-11', scheduledTime: '09:00' },
    ]);
    const tx = {
      select: () => chain,
      update: () => updateChain([{ id: TASK_ID }]),
      insert: () => {
        throw new Error('insert should not run');
      },
      delete: () => {
        throw new Error('delete should not run');
      },
    };

    await applyUpload(tx as never, USER_ID, [
      {
        clientId: 2,
        op: 'PATCH',
        table: 'tasks',
        id: TASK_ID,
        opData: { scheduled_time: '10:30' },
      },
    ]);

    expect(forFn).toHaveBeenCalledWith('update');
  });

  it('rejects a time-only PATCH after the locked row has no date', async () => {
    const { chain, forFn } = selectChain([
      { userId: USER_ID, scheduledDate: null, scheduledTime: null },
    ]);
    const tx = {
      select: () => chain,
      update: () => {
        throw new Error('update should not run');
      },
      insert: () => {
        throw new Error('insert should not run');
      },
      delete: () => {
        throw new Error('delete should not run');
      },
    };

    await expect(
      applyUpload(tx as never, USER_ID, [
        {
          clientId: 2,
          op: 'PATCH',
          table: 'tasks',
          id: TASK_ID,
          opData: { scheduled_time: '10:30' },
        },
      ]),
    ).rejects.toBeInstanceOf(InvalidRequestError);

    expect(forFn).toHaveBeenCalledWith('update');
  });
});
