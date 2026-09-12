import { describe, expect, it, vi } from 'vitest';
import { applyUpload, ForbiddenError, InvalidRequestError } from './apply-upload.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const TASK_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJECT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
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

function insertUpsert(rows: unknown[]) {
  return {
    values: () => ({
      onConflictDoUpdate: () => ({
        returning: () => Promise.resolve(rows),
      }),
    }),
  };
}

describe('applyUpload task membership', () => {
  it('locks the destination project with FOR UPDATE before a task PUT', async () => {
    const project = selectChain([{ userId: USER_ID }]);
    const insert = vi.fn(() => insertUpsert([{ id: TASK_ID }]));
    const tx = {
      select: () => project.chain,
      insert,
      update: () => {
        throw new Error('update should not run');
      },
      delete: () => {
        throw new Error('delete should not run');
      },
    };

    await applyUpload(tx as never, USER_ID, [
      {
        clientId: 1,
        op: 'PUT',
        table: 'tasks',
        id: TASK_ID,
        opData: {
          title: 'Task',
          description: '',
          priority: 4,
          created_at: CREATED_AT,
          project_id: PROJECT_ID,
        },
      },
    ]);

    expect(project.forFn).toHaveBeenCalledWith('update');
    expect(insert).toHaveBeenCalled();
  });

  it('accepts a reference to an owned archived project', async () => {
    const project = selectChain([{ userId: USER_ID }]);
    const insert = vi.fn(() => insertUpsert([{ id: TASK_ID }]));
    const tx = {
      select: () => project.chain,
      insert,
      update: () => {
        throw new Error('update should not run');
      },
      delete: () => {
        throw new Error('delete should not run');
      },
    };

    await applyUpload(tx as never, USER_ID, [
      {
        clientId: 1,
        op: 'PUT',
        table: 'tasks',
        id: TASK_ID,
        opData: {
          title: 'Task',
          description: '',
          priority: 4,
          created_at: CREATED_AT,
          project_id: PROJECT_ID,
        },
      },
    ]);

    expect(insert).toHaveBeenCalled();
  });

  it('rejects a missing or foreign destination on PUT', async () => {
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
        {
          clientId: 1,
          op: 'PUT',
          table: 'tasks',
          id: TASK_ID,
          opData: {
            title: 'Task',
            description: '',
            priority: 4,
            created_at: CREATED_AT,
            project_id: PROJECT_ID,
          },
        },
      ]),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('locks the project before the task when PATCHing membership', async () => {
    const project = selectChain([{ userId: USER_ID }]);
    const task = selectChain([{ userId: USER_ID, scheduledDate: null, scheduledTime: null }]);
    let selects = 0;
    const tx = {
      select: () => {
        selects += 1;
        return selects === 1 ? project.chain : task.chain;
      },
      insert: () => {
        throw new Error('insert should not run');
      },
      update: () => updateChain([{ id: TASK_ID }]),
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
        opData: { project_id: PROJECT_ID },
      },
    ]);

    expect(project.forFn).toHaveBeenCalledWith('update');
    expect(task.forFn).toHaveBeenCalledWith('update');
  });

  it('no-ops a missing task PATCH even with a stale project_id', async () => {
    const project = selectChain([]);
    const task = selectChain([]);
    let selects = 0;
    const tx = {
      select: () => {
        selects += 1;
        return selects === 1 ? project.chain : task.chain;
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
      {
        clientId: 2,
        op: 'PATCH',
        table: 'tasks',
        id: TASK_ID,
        opData: { project_id: PROJECT_ID },
      },
    ]);
  });

  it('does not lock or rewrite membership on an omitted project PATCH', async () => {
    const tx = {
      select: () => {
        throw new Error('select should not run');
      },
      insert: () => {
        throw new Error('insert should not run');
      },
      update: () => updateChain([{ id: TASK_ID }]),
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
        opData: { title: 'Renamed' },
      },
    ]);
  });

  it('applies a project PUT before a referencing task PUT in the given order', async () => {
    const order: string[] = [];
    const projectInsert = vi.fn(() => {
      order.push('project');
      return insertUpsert([{ id: PROJECT_ID }]);
    });
    const projectLock = selectChain([{ userId: USER_ID }]);
    const taskInsert = vi.fn(() => {
      order.push('task');
      return insertUpsert([{ id: TASK_ID }]);
    });
    const tx = {
      select: () => projectLock.chain,
      insert: (table: unknown) => {
        const name =
          table && typeof table === 'object' && 'name' in table
            ? String((table as { name?: string }).name)
            : '';
        if (name === 'projects' || order.length === 0) return projectInsert();
        return taskInsert();
      },
      update: () => {
        throw new Error('update should not run');
      },
      delete: () => {
        throw new Error('delete should not run');
      },
    };

    await applyUpload(tx as never, USER_ID, [
      {
        clientId: 1,
        op: 'PUT',
        table: 'projects',
        id: PROJECT_ID,
        opData: {
          name: 'Work',
          color: 'charcoal',
          is_favorite: false,
          is_archived: false,
          sort_order: 0,
          created_at: CREATED_AT,
        },
      },
      {
        clientId: 2,
        op: 'PUT',
        table: 'tasks',
        id: TASK_ID,
        opData: {
          title: 'Task',
          description: '',
          priority: 4,
          created_at: CREATED_AT,
          project_id: PROJECT_ID,
        },
      },
    ]);

    expect(order).toEqual(['project', 'task']);
  });
});
