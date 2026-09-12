import { describe, expect, it, vi } from 'vitest';
import { applyUpload, ForbiddenError } from './apply-upload.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const TASK_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LABEL_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const LINK_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const CREATED_AT = '2026-09-11T12:00:00.000Z';

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

function putLink() {
  return {
    clientId: 1,
    op: 'PUT' as const,
    table: 'task_labels' as const,
    id: LINK_ID,
    opData: { task_id: TASK_ID, label_id: LABEL_ID, created_at: CREATED_AT },
  };
}

describe('applyUpload task_labels', () => {
  it('locks the referenced task and label with FOR UPDATE before inserting', async () => {
    const task = selectChain([{ userId: USER_ID }]);
    const label = selectChain([{ userId: USER_ID }]);
    const existingById = selectChain([]);
    const existingPair = selectChain([]);
    let selects = 0;
    const insert = vi.fn(() => ({
      values: () => ({
        onConflictDoUpdate: () => ({
          returning: () => Promise.resolve([{ id: LINK_ID }]),
        }),
      }),
    }));
    const tx = {
      select: () => {
        selects += 1;
        if (selects === 1) return task.chain;
        if (selects === 2) return label.chain;
        if (selects === 3) return existingById.chain;
        return existingPair.chain;
      },
      execute: () => {
        throw new Error('execute should not run');
      },
      insert,
      update: () => {
        throw new Error('update should not run');
      },
      delete: () => {
        throw new Error('delete should not run');
      },
    };

    await applyUpload(tx as never, USER_ID, [putLink()]);

    expect(task.forFn).toHaveBeenCalledWith('update');
    expect(label.forFn).toHaveBeenCalledWith('update');
    expect(existingById.forFn).toHaveBeenCalledWith('update');
    expect(existingPair.forFn).toHaveBeenCalledWith('update');
    expect(insert).toHaveBeenCalled();
  });

  it('no-ops when the task+label pair already exists under a different id', async () => {
    const task = selectChain([{ userId: USER_ID }]);
    const label = selectChain([{ userId: USER_ID }]);
    const existingById = selectChain([]);
    const existingPair = selectChain([{ id: '99999999-9999-4999-8999-999999999999' }]);
    let selects = 0;
    const tx = {
      select: () => {
        selects += 1;
        if (selects === 1) return task.chain;
        if (selects === 2) return label.chain;
        if (selects === 3) return existingById.chain;
        return existingPair.chain;
      },
      execute: () => {
        throw new Error('execute should not run');
      },
      insert: () => {
        throw new Error('insert should not run');
      },
      update: () => {
        throw new Error('update should not run');
      },
      delete: () => {
        throw new Error('delete should not run');
      },
    };

    await applyUpload(tx as never, USER_ID, [putLink()]);

    expect(existingPair.forFn).toHaveBeenCalledWith('update');
  });

  it('rejects a link to a missing or foreign task before insert', async () => {
    const task = selectChain([{ userId: OTHER_ID }]);
    const tx = {
      select: () => task.chain,
      execute: () => {
        throw new Error('execute should not run');
      },
      insert: () => {
        throw new Error('insert should not run');
      },
      update: () => {
        throw new Error('update should not run');
      },
      delete: () => {
        throw new Error('delete should not run');
      },
    };

    await expect(applyUpload(tx as never, USER_ID, [putLink()])).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
