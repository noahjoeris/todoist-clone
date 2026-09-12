import { describe, expect, it, vi } from 'vitest';
import { applyUpload, ForbiddenError, InvalidRequestError } from './apply-upload.js';
import { PROJECTS_NAME_UNIQUE } from './errors.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const PROJECT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TASK_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
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

function insertUpsert(rows: unknown[] | Promise<never>) {
  return {
    values: () => ({
      onConflictDoUpdate: () => ({
        returning: () => (rows instanceof Promise ? rows : Promise.resolve(rows)),
      }),
    }),
  };
}

function updateChain(rows: unknown[]) {
  const setFn = vi.fn();
  const chain = {
    set: (value: unknown) => {
      setFn(value);
      return chain;
    },
    where: () => chain,
    returning: () => Promise.resolve(rows),
  };
  return { chain, setFn };
}

function putProject(opData: Record<string, unknown> = {}) {
  return {
    clientId: 1,
    op: 'PUT' as const,
    table: 'projects' as const,
    id: PROJECT_ID,
    opData: {
      name: 'Work',
      color: 'charcoal' as const,
      is_favorite: false,
      is_archived: false,
      sort_order: 0,
      created_at: CREATED_AT,
      ...opData,
    },
  };
}

describe('applyUpload projects', () => {
  it('upserts an owned project PUT', async () => {
    const insert = vi.fn(() => insertUpsert([{ id: PROJECT_ID }]));
    const tx = {
      select: () => {
        throw new Error('select should not run');
      },
      insert,
      update: () => {
        throw new Error('update should not run');
      },
      delete: () => {
        throw new Error('delete should not run');
      },
    };

    await applyUpload(tx as never, USER_ID, [putProject()]);
    expect(insert).toHaveBeenCalled();
  });

  it('rejects PUT of a foreign project id', async () => {
    const tx = {
      select: () => {
        throw new Error('select should not run');
      },
      insert: () => insertUpsert([]),
      update: () => {
        throw new Error('update should not run');
      },
      delete: () => {
        throw new Error('delete should not run');
      },
    };

    await expect(applyUpload(tx as never, USER_ID, [putProject()])).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('maps a duplicate-name unique violation to invalid-request', async () => {
    const tx = {
      select: () => {
        throw new Error('select should not run');
      },
      insert: () =>
        insertUpsert(
          Promise.reject(
            Object.assign(new Error('duplicate key'), {
              code: '23505',
              constraint_name: PROJECTS_NAME_UNIQUE,
            }),
          ),
        ),
      update: () => {
        throw new Error('update should not run');
      },
      delete: () => {
        throw new Error('delete should not run');
      },
    };

    await expect(applyUpload(tx as never, USER_ID, [putProject()])).rejects.toBeInstanceOf(
      InvalidRequestError,
    );
    await expect(applyUpload(tx as never, USER_ID, [putProject()])).rejects.toMatchObject({
      issues: [{ path: 'name' }],
    });
  });

  it('no-ops a PATCH of only server-owned keys', async () => {
    const tx = {
      select: () => {
        throw new Error('select should not run');
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

    await applyUpload(tx as never, USER_ID, [
      { clientId: 2, op: 'PATCH', table: 'projects', id: PROJECT_ID, opData: {} },
    ]);
  });

  it('field-only PATCH updates the supplied columns', async () => {
    const { chain, setFn } = updateChain([{ id: PROJECT_ID }]);
    const tx = {
      select: () => {
        throw new Error('select should not run');
      },
      insert: () => {
        throw new Error('insert should not run');
      },
      update: () => chain,
      delete: () => {
        throw new Error('delete should not run');
      },
    };

    await applyUpload(tx as never, USER_ID, [
      {
        clientId: 2,
        op: 'PATCH',
        table: 'projects',
        id: PROJECT_ID,
        opData: { name: 'Office', is_archived: true, sort_order: 3 },
      },
    ]);

    expect(setFn).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Office',
        isArchived: true,
        sortOrder: 3,
      }),
    );
  });

  it('no-ops DELETE of a missing project', async () => {
    const project = selectChain([]);
    const tx = {
      select: () => project.chain,
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

    await applyUpload(tx as never, USER_ID, [
      { clientId: 3, op: 'DELETE', table: 'projects', id: PROJECT_ID, opData: null },
    ]);
    expect(project.forFn).toHaveBeenCalledWith('update');
  });

  it('rejects DELETE of a foreign project', async () => {
    const project = selectChain([{ userId: OTHER_ID }]);
    const tx = {
      select: () => project.chain,
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

    await expect(
      applyUpload(tx as never, USER_ID, [
        { clientId: 3, op: 'DELETE', table: 'projects', id: PROJECT_ID, opData: null },
      ]),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('locks the project then member tasks before clearing membership and deleting', async () => {
    const project = selectChain([{ userId: USER_ID }]);
    const members = selectChain([{ id: TASK_ID }]);
    let selects = 0;
    const { chain: update, setFn } = updateChain([{ id: TASK_ID }]);
    const deleteFn = vi.fn(() => ({
      where: () => Promise.resolve([{ id: PROJECT_ID }]),
    }));
    const tx = {
      select: () => {
        selects += 1;
        return selects === 1 ? project.chain : members.chain;
      },
      insert: () => {
        throw new Error('insert should not run');
      },
      update: () => update,
      delete: deleteFn,
    };

    await applyUpload(tx as never, USER_ID, [
      { clientId: 3, op: 'DELETE', table: 'projects', id: PROJECT_ID, opData: null },
    ]);

    expect(project.forFn).toHaveBeenCalledWith('update');
    expect(members.forFn).toHaveBeenCalledWith('update');
    expect(setFn).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: null,
      }),
    );
    expect(deleteFn).toHaveBeenCalled();
  });
});
