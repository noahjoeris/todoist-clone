import { createDatabaseConnection, sql } from '@todoist-clone/database';
import { describe, expect, it } from 'vitest';
import {
  CASCADE_ID,
  database,
  loadLabel,
  loadProject,
  loadTask,
  loadTaskLabel,
  OTHER_ID,
  OWNER_ID,
  putLabelOp,
  putOp,
  putProjectOp,
  putTaskLabelOp,
  upload,
} from './setup.js';

const OWN_TASK = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_TASK = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MISSING_TASK = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OWN_PROJECT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01';
const OTHER_PROJECT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02';
const SECOND_PROJECT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb03';
const MISSING_PROJECT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb04';
const OWN_LABEL = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const OWN_LINK = '99999999-9999-4999-8999-999999999999';
const SECOND_TASK = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

describe('POST /sync/upload projects (integration)', () => {
  it('PUT inserts a project owned by the JWT and ignores opData.user_id', async () => {
    const response = await upload(OWNER_ID, [
      putProjectOp(OWN_PROJECT, { name: 'Work', user_id: OTHER_ID }),
    ]);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ applied: 1 });

    const row = await loadProject(OWN_PROJECT);
    expect(row).toMatchObject({
      id: OWN_PROJECT,
      userId: OWNER_ID,
      name: 'Work',
      color: 'charcoal',
      isFavorite: false,
      isArchived: false,
      sortOrder: 0,
    });
  });

  it('normalizes SQLite integer 0/1 favorite and archived values to boolean', async () => {
    const zero = await upload(OWNER_ID, [
      putProjectOp(OWN_PROJECT, { name: 'A', is_favorite: 0, is_archived: 0 }),
    ]);
    expect(zero.statusCode).toBe(200);
    expect(await loadProject(OWN_PROJECT)).toMatchObject({
      isFavorite: false,
      isArchived: false,
    });

    const one = await upload(OWNER_ID, [
      putProjectOp(OWN_PROJECT, { name: 'A', is_favorite: 1, is_archived: 1 }),
    ]);
    expect(one.statusCode).toBe(200);
    expect(await loadProject(OWN_PROJECT)).toMatchObject({
      isFavorite: true,
      isArchived: true,
    });
  });

  it('PUT of own existing project replaces it and bumps updated_at', async () => {
    await upload(OWNER_ID, [putProjectOp(OWN_PROJECT, { name: 'Work', color: 'red' })]);
    const before = await loadProject(OWN_PROJECT);
    if (!before) throw new Error('expected row');

    const response = await upload(OWNER_ID, [
      putProjectOp(OWN_PROJECT, {
        name: 'Office',
        color: 'blue',
        is_favorite: true,
        sort_order: 4,
      }),
    ]);
    expect(response.statusCode).toBe(200);
    const after = await loadProject(OWN_PROJECT);
    expect(after).toMatchObject({
      name: 'Office',
      color: 'blue',
      isFavorite: true,
      sortOrder: 4,
    });
    expect(after && after.updatedAt >= before.updatedAt).toBe(true);
  });

  it("PUT of another user's project id returns 403 and leaves the row unchanged", async () => {
    await upload(OTHER_ID, [putProjectOp(OTHER_PROJECT, { name: 'Other' })]);
    const response = await upload(OWNER_ID, [putProjectOp(OTHER_PROJECT, { name: 'Stolen' })]);
    expect(response.statusCode).toBe(403);
    expect((await loadProject(OTHER_PROJECT))?.name).toBe('Other');
    expect((await loadProject(OTHER_PROJECT))?.userId).toBe(OTHER_ID);
  });

  it('PATCH updates own project; omitted fields stay unchanged', async () => {
    await upload(OWNER_ID, [
      putProjectOp(OWN_PROJECT, {
        name: 'Work',
        color: 'red',
        is_favorite: true,
        sort_order: 2,
        is_archived: false,
      }),
    ]);
    const response = await upload(OWNER_ID, [
      { clientId: 2, op: 'PATCH', table: 'projects', id: OWN_PROJECT, opData: { name: 'Office' } },
    ]);
    expect(response.statusCode).toBe(200);
    expect(await loadProject(OWN_PROJECT)).toMatchObject({
      name: 'Office',
      color: 'red',
      isFavorite: true,
      sortOrder: 2,
      isArchived: false,
    });
  });

  it('archives and unarchives without mutating member tasks', async () => {
    await upload(OWNER_ID, [
      putProjectOp(OWN_PROJECT, { name: 'Work' }),
      putOp(OWN_TASK, { title: 'Keep', project_id: OWN_PROJECT }, 2),
    ]);
    const before = await loadTask(OWN_TASK);

    const archived = await upload(OWNER_ID, [
      {
        clientId: 3,
        op: 'PATCH',
        table: 'projects',
        id: OWN_PROJECT,
        opData: { is_archived: true },
      },
    ]);
    expect(archived.statusCode).toBe(200);
    expect((await loadProject(OWN_PROJECT))?.isArchived).toBe(true);
    expect(await loadTask(OWN_TASK)).toMatchObject({
      title: 'Keep',
      projectId: OWN_PROJECT,
      completedAt: before?.completedAt ?? null,
    });

    const restored = await upload(OWNER_ID, [
      {
        clientId: 4,
        op: 'PATCH',
        table: 'projects',
        id: OWN_PROJECT,
        opData: { is_archived: false },
      },
    ]);
    expect(restored.statusCode).toBe(200);
    expect((await loadProject(OWN_PROJECT))?.isArchived).toBe(false);
    expect((await loadTask(OWN_TASK))?.projectId).toBe(OWN_PROJECT);
  });

  it('allows duplicate sort_order ties for the same owner', async () => {
    const response = await upload(OWNER_ID, [
      putProjectOp(OWN_PROJECT, { name: 'A', sort_order: 5 }),
      putProjectOp(SECOND_PROJECT, { name: 'B', sort_order: 5 }, 2),
    ]);
    expect(response.statusCode).toBe(200);
    expect((await loadProject(OWN_PROJECT))?.sortOrder).toBe(5);
    expect((await loadProject(SECOND_PROJECT))?.sortOrder).toBe(5);
  });

  it("PATCH of another user's project returns 403", async () => {
    await upload(OTHER_ID, [putProjectOp(OTHER_PROJECT, { name: 'Other' })]);
    const response = await upload(OWNER_ID, [
      { clientId: 2, op: 'PATCH', table: 'projects', id: OTHER_PROJECT, opData: { name: 'Nope' } },
    ]);
    expect(response.statusCode).toBe(403);
    expect((await loadProject(OTHER_PROJECT))?.name).toBe('Other');
  });

  it('PATCH of a missing project is a no-op 200', async () => {
    const response = await upload(OWNER_ID, [
      {
        clientId: 2,
        op: 'PATCH',
        table: 'projects',
        id: MISSING_PROJECT,
        opData: { name: 'Ghost' },
      },
    ]);
    expect(response.statusCode).toBe(200);
    expect(await loadProject(MISSING_PROJECT)).toBeNull();
  });

  it('ignores PATCH user_id and treats an empty-after-strip patch as a no-op', async () => {
    await upload(OWNER_ID, [putProjectOp(OWN_PROJECT, { name: 'Stay' })]);
    const response = await upload(OWNER_ID, [
      {
        clientId: 2,
        op: 'PATCH',
        table: 'projects',
        id: OWN_PROJECT,
        opData: { user_id: OTHER_ID },
      },
    ]);
    expect(response.statusCode).toBe(200);
    expect((await loadProject(OWN_PROJECT))?.name).toBe('Stay');
    expect((await loadProject(OWN_PROJECT))?.userId).toBe(OWNER_ID);
  });

  it('DELETE removes own project', async () => {
    await upload(OWNER_ID, [putProjectOp(OWN_PROJECT)]);
    const response = await upload(OWNER_ID, [
      { clientId: 3, op: 'DELETE', table: 'projects', id: OWN_PROJECT, opData: null },
    ]);
    expect(response.statusCode).toBe(200);
    expect(await loadProject(OWN_PROJECT)).toBeNull();
  });

  it("DELETE of another user's project returns 403", async () => {
    await upload(OTHER_ID, [putProjectOp(OTHER_PROJECT)]);
    const response = await upload(OWNER_ID, [
      { clientId: 3, op: 'DELETE', table: 'projects', id: OTHER_PROJECT, opData: null },
    ]);
    expect(response.statusCode).toBe(403);
    expect(await loadProject(OTHER_PROJECT)).not.toBeNull();
  });

  it('DELETE of a missing project is a no-op 200 and can be retried', async () => {
    const batch = [
      {
        clientId: 3,
        op: 'DELETE' as const,
        table: 'projects' as const,
        id: MISSING_PROJECT,
        opData: null,
      },
    ];
    expect((await upload(OWNER_ID, batch)).statusCode).toBe(200);
    expect((await upload(OWNER_ID, batch, 9)).statusCode).toBe(200);
  });

  it('rejects invalid names, colors, and order at Zod', async () => {
    const blank = await upload(OWNER_ID, [putProjectOp(OWN_PROJECT, { name: '  ' })]);
    expect(blank.statusCode).toBe(400);
    expect(blank.json().error).toBe('invalid-request');

    const color = await upload(OWNER_ID, [putProjectOp(OWN_PROJECT, { color: 'hot_pink' })]);
    expect(color.statusCode).toBe(400);

    const order = await upload(OWNER_ID, [putProjectOp(OWN_PROJECT, { sort_order: -1 })]);
    expect(order.statusCode).toBe(400);
    expect(await loadProject(OWN_PROJECT)).toBeNull();
  });

  it('rejects a case-insensitive duplicate name with 400 and a name issue', async () => {
    await upload(OWNER_ID, [putProjectOp(OWN_PROJECT, { name: 'Work' })]);
    const response = await upload(OWNER_ID, [putProjectOp(SECOND_PROJECT, { name: 'WORK' })]);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: 'invalid-request',
      issues: [{ path: 'name' }],
    });
    expect(await loadProject(SECOND_PROJECT)).toBeNull();
  });

  it('rejects a duplicate name against an archived project of the same user', async () => {
    await upload(OWNER_ID, [putProjectOp(OWN_PROJECT, { name: 'Work', is_archived: true })]);
    const response = await upload(OWNER_ID, [putProjectOp(SECOND_PROJECT, { name: 'work' })]);
    expect(response.statusCode).toBe(400);
    expect(await loadProject(SECOND_PROJECT)).toBeNull();
  });

  it('allows the same name for two users', async () => {
    await upload(OWNER_ID, [putProjectOp(OWN_PROJECT, { name: 'Work' })]);
    const response = await upload(OTHER_ID, [putProjectOp(OTHER_PROJECT, { name: 'Work' })]);
    expect(response.statusCode).toBe(200);
    expect((await loadProject(OTHER_PROJECT))?.userId).toBe(OTHER_ID);
  });

  it('allows a project name that collides with a label name', async () => {
    await upload(OWNER_ID, [putLabelOp(OWN_LABEL, { name: 'Work' })]);
    const response = await upload(OWNER_ID, [putProjectOp(OWN_PROJECT, { name: 'Work' })]);
    expect(response.statusCode).toBe(200);
    expect((await loadProject(OWN_PROJECT))?.name).toBe('Work');
  });
});

describe('POST /sync/upload task project membership (integration)', () => {
  it('PUT defaults omitted project_id to Inbox', async () => {
    const response = await upload(OWNER_ID, [putOp(OWN_TASK, { title: 'Inbox' })]);
    expect(response.statusCode).toBe(200);
    expect((await loadTask(OWN_TASK))?.projectId).toBeNull();
  });

  it('PUT with explicit null project_id stores Inbox', async () => {
    await upload(OWNER_ID, [putProjectOp(OWN_PROJECT)]);
    const response = await upload(OWNER_ID, [putOp(OWN_TASK, { project_id: null })]);
    expect(response.statusCode).toBe(200);
    expect((await loadTask(OWN_TASK))?.projectId).toBeNull();
  });

  it('assigns membership on PUT and keeps labels, dates, and completion', async () => {
    await upload(OWNER_ID, [
      putProjectOp(OWN_PROJECT, { name: 'Work' }),
      putOp(
        OWN_TASK,
        {
          title: 'Keep',
          description: 'Notes',
          priority: 2,
          scheduled_date: '2026-09-11',
          scheduled_time: '09:00',
          completed_at: '2026-09-11T15:00:00.000Z',
          project_id: OWN_PROJECT,
        },
        2,
      ),
      putLabelOp(OWN_LABEL, { name: 'Work' }, 3),
      putTaskLabelOp(OWN_LINK, OWN_TASK, OWN_LABEL, {}, 4),
    ]);

    const row = await loadTask(OWN_TASK);
    expect(row).toMatchObject({
      title: 'Keep',
      description: 'Notes',
      priority: 2,
      scheduledDate: '2026-09-11',
      completedAt: '2026-09-11T15:00:00.000Z',
      projectId: OWN_PROJECT,
    });
    expect(await loadTaskLabel(OWN_LINK)).not.toBeNull();
  });

  it('retries a project-before-task create batch', async () => {
    const batch = [
      putProjectOp(OWN_PROJECT, { name: 'Work' }),
      putOp(OWN_TASK, { title: 'Task', project_id: OWN_PROJECT }, 2),
    ];
    expect((await upload(OWNER_ID, batch)).statusCode).toBe(200);
    expect((await upload(OWNER_ID, batch, 9)).statusCode).toBe(200);
    expect((await loadTask(OWN_TASK))?.projectId).toBe(OWN_PROJECT);
  });

  it('PATCH assigns and clears membership; omitted project_id is unchanged', async () => {
    await upload(OWNER_ID, [
      putProjectOp(OWN_PROJECT),
      putOp(OWN_TASK, { title: 'Stay', project_id: OWN_PROJECT }, 2),
    ]);

    const renamed = await upload(OWNER_ID, [
      { clientId: 3, op: 'PATCH', table: 'tasks', id: OWN_TASK, opData: { title: 'Still' } },
    ]);
    expect(renamed.statusCode).toBe(200);
    expect(await loadTask(OWN_TASK)).toMatchObject({
      title: 'Still',
      projectId: OWN_PROJECT,
    });

    const cleared = await upload(OWNER_ID, [
      { clientId: 4, op: 'PATCH', table: 'tasks', id: OWN_TASK, opData: { project_id: null } },
    ]);
    expect(cleared.statusCode).toBe(200);
    expect((await loadTask(OWN_TASK))?.projectId).toBeNull();
  });

  it('accepts a PUT/PATCH onto an owned archived project', async () => {
    await upload(OWNER_ID, [putProjectOp(OWN_PROJECT, { name: 'Old', is_archived: true })]);
    const created = await upload(OWNER_ID, [putOp(OWN_TASK, { project_id: OWN_PROJECT })]);
    expect(created.statusCode).toBe(200);
    expect((await loadTask(OWN_TASK))?.projectId).toBe(OWN_PROJECT);

    await upload(OWNER_ID, [putOp(SECOND_TASK, { title: 'Other' })]);
    const patched = await upload(OWNER_ID, [
      {
        clientId: 3,
        op: 'PATCH',
        table: 'tasks',
        id: SECOND_TASK,
        opData: { project_id: OWN_PROJECT },
      },
    ]);
    expect(patched.statusCode).toBe(200);
    expect((await loadTask(SECOND_TASK))?.projectId).toBe(OWN_PROJECT);
  });

  it('rejects a missing non-null project_id with 403, not a 500', async () => {
    const response = await upload(OWNER_ID, [putOp(OWN_TASK, { project_id: MISSING_PROJECT })]);
    expect(response.statusCode).toBe(403);
    expect(await loadTask(OWN_TASK)).toBeNull();
  });

  it("rejects assigning another user's project to an owned task", async () => {
    await upload(OWNER_ID, [putOp(OWN_TASK)]);
    await upload(OTHER_ID, [putProjectOp(OTHER_PROJECT, { name: 'Other' })]);
    const response = await upload(OWNER_ID, [
      {
        clientId: 2,
        op: 'PATCH',
        table: 'tasks',
        id: OWN_TASK,
        opData: { project_id: OTHER_PROJECT },
      },
    ]);
    expect(response.statusCode).toBe(403);
    expect((await loadTask(OWN_TASK))?.projectId).toBeNull();
  });

  it("rejects assigning an owned project to another user's task", async () => {
    await upload(OWNER_ID, [putProjectOp(OWN_PROJECT)]);
    await upload(OTHER_ID, [putOp(OTHER_TASK)]);
    const response = await upload(OWNER_ID, [
      {
        clientId: 2,
        op: 'PATCH',
        table: 'tasks',
        id: OTHER_TASK,
        opData: { project_id: OWN_PROJECT },
      },
    ]);
    expect(response.statusCode).toBe(403);
    expect((await loadTask(OTHER_TASK))?.projectId).toBeNull();
  });

  it('PATCH of a missing task with a stale project_id is a no-op 200', async () => {
    const response = await upload(OWNER_ID, [
      {
        clientId: 2,
        op: 'PATCH',
        table: 'tasks',
        id: MISSING_TASK,
        opData: { project_id: MISSING_PROJECT },
      },
    ]);
    expect(response.statusCode).toBe(200);
    expect(await loadTask(MISSING_TASK)).toBeNull();
  });

  it('rolls back mixed project/task/label writes when a later op is forbidden', async () => {
    await upload(OTHER_ID, [putProjectOp(OTHER_PROJECT, { name: 'Other' })]);
    const response = await upload(OWNER_ID, [
      putProjectOp(OWN_PROJECT, { name: 'Should not stick' }),
      putOp(OWN_TASK, { title: 'Should not stick' }, 2),
      putLabelOp(OWN_LABEL, { name: 'Should not stick' }, 3),
      {
        clientId: 4,
        op: 'PATCH',
        table: 'tasks',
        id: OWN_TASK,
        opData: { project_id: OTHER_PROJECT },
      },
    ]);
    expect(response.statusCode).toBe(403);
    expect(await loadProject(OWN_PROJECT)).toBeNull();
    expect(await loadTask(OWN_TASK)).toBeNull();
    expect(await loadLabel(OWN_LABEL)).toBeNull();
  });
});

describe('POST /sync/upload project deletion (integration)', () => {
  it('returns active and completed members to Inbox without dropping labels', async () => {
    await upload(OWNER_ID, [
      putProjectOp(OWN_PROJECT, { name: 'Work' }),
      putOp(OWN_TASK, { title: 'Active', project_id: OWN_PROJECT }, 2),
      putOp(
        SECOND_TASK,
        {
          title: 'Done',
          completed_at: '2026-09-11T15:00:00.000Z',
          project_id: OWN_PROJECT,
        },
        3,
      ),
      putLabelOp(OWN_LABEL, { name: 'Work' }, 4),
      putTaskLabelOp(OWN_LINK, OWN_TASK, OWN_LABEL, {}, 5),
    ]);

    const response = await upload(OWNER_ID, [
      { clientId: 6, op: 'PATCH', table: 'tasks', id: OWN_TASK, opData: { project_id: null } },
      { clientId: 7, op: 'PATCH', table: 'tasks', id: SECOND_TASK, opData: { project_id: null } },
      { clientId: 8, op: 'DELETE', table: 'projects', id: OWN_PROJECT, opData: null },
    ]);
    expect(response.statusCode).toBe(200);
    expect(await loadProject(OWN_PROJECT)).toBeNull();
    expect((await loadTask(OWN_TASK))?.projectId).toBeNull();
    expect(await loadTask(SECOND_TASK)).toMatchObject({
      projectId: null,
      completedAt: '2026-09-11T15:00:00.000Z',
    });
    expect(await loadTaskLabel(OWN_LINK)).not.toBeNull();
    expect(await loadLabel(OWN_LABEL)).not.toBeNull();
  });

  it('clears members the deleting client had not queued and retries DELETE', async () => {
    await upload(OWNER_ID, [
      putProjectOp(OWN_PROJECT),
      putOp(OWN_TASK, { project_id: OWN_PROJECT }, 2),
    ]);

    const batch = [
      {
        clientId: 3,
        op: 'DELETE' as const,
        table: 'projects' as const,
        id: OWN_PROJECT,
        opData: null,
      },
    ];
    expect((await upload(OWNER_ID, batch)).statusCode).toBe(200);
    expect((await loadTask(OWN_TASK))?.projectId).toBeNull();
    expect(await loadProject(OWN_PROJECT)).toBeNull();
    expect((await upload(OWNER_ID, batch, 9)).statusCode).toBe(200);
  });

  it('rejects a task write that references an already-deleted project', async () => {
    await upload(OWNER_ID, [putProjectOp(OWN_PROJECT), putOp(OWN_TASK, {}, 2)]);
    await upload(OWNER_ID, [
      { clientId: 3, op: 'DELETE', table: 'projects', id: OWN_PROJECT, opData: null },
    ]);

    const response = await upload(OWNER_ID, [
      {
        clientId: 4,
        op: 'PATCH',
        table: 'tasks',
        id: OWN_TASK,
        opData: { project_id: OWN_PROJECT },
      },
    ]);
    expect(response.statusCode).toBe(403);
    expect((await loadTask(OWN_TASK))?.projectId).toBeNull();
  });

  it('rejects a membership write that races a concurrent project delete', async () => {
    await upload(OWNER_ID, [
      putProjectOp(OWN_PROJECT, { name: 'Work' }),
      putOp(OWN_TASK, { title: 'Task' }, 2),
    ]);

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL is required');
    const blocker = createDatabaseConnection({ url: databaseUrl, maxConnections: 1 });
    let assignment: ReturnType<typeof upload> | undefined;
    try {
      await blocker.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM projects WHERE id = ${OWN_PROJECT}::uuid FOR UPDATE`);
        assignment = upload(OWNER_ID, [
          {
            clientId: 3,
            op: 'PATCH',
            table: 'tasks',
            id: OWN_TASK,
            opData: { project_id: OWN_PROJECT },
          },
        ]);
        await new Promise((resolve) => setTimeout(resolve, 400));
        await tx.execute(sql`DELETE FROM projects WHERE id = ${OWN_PROJECT}::uuid`);
      });
      if (!assignment) throw new Error('expected assignment');
      const response = await assignment;
      expect(response.statusCode).toBe(403);
      expect((await loadTask(OWN_TASK))?.projectId).toBeNull();
      expect(await loadProject(OWN_PROJECT)).toBeNull();
    } finally {
      await blocker.close();
    }
  });

  it('deleting the user cascades projects and their tasks', async () => {
    const taskId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac';
    const projectId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb0c';

    const created = await upload(CASCADE_ID, [
      putProjectOp(projectId, { name: 'Cascade' }),
      putOp(taskId, { title: 'Cascade', project_id: projectId }, 2),
    ]);
    expect(created.statusCode).toBe(200);

    await database.db.execute(sql`DELETE FROM auth.users WHERE id = ${CASCADE_ID}::uuid`);

    expect(await loadTask(taskId)).toBeNull();
    expect(await loadProject(projectId)).toBeNull();

    await database.db.execute(sql`SET session_replication_role = replica`);
    await database.db.execute(
      sql`INSERT INTO auth.users (id) VALUES (${CASCADE_ID}::uuid) ON CONFLICT (id) DO NOTHING`,
    );
    await database.db.execute(sql`SET session_replication_role = DEFAULT`);
  });
});

describe('projects schema on the fresh initial migration', () => {
  it('publishes projects and constrains names, colors, order, and SET NULL', async () => {
    const published = await database.db.execute(sql`
      SELECT tablename FROM pg_publication_tables
      WHERE pubname = 'powersync' AND tablename = 'projects'
    `);
    expect(published).toEqual(
      expect.arrayContaining([expect.objectContaining({ tablename: 'projects' })]),
    );

    const columns = await database.db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'projects'
      ORDER BY column_name
    `);
    const names = columns.map((row) => row.column_name);
    expect(names).toEqual([
      'color',
      'created_at',
      'id',
      'is_archived',
      'is_favorite',
      'name',
      'sort_order',
      'updated_at',
      'user_id',
    ]);
    expect(names).not.toContain('parent_id');
    expect(names).not.toContain('section_id');
    expect(names).not.toContain('view_style');
    expect(names).not.toContain('is_inbox_project');

    await expect(
      database.db.execute(sql`
        INSERT INTO public.projects (id, user_id, name)
        VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb10'::uuid, ${OWNER_ID}::uuid, '  ')
      `),
    ).rejects.toThrow();

    const fk = await database.db.execute(sql`
      SELECT confdeltype FROM pg_constraint
      WHERE conname = 'tasks_project_id_projects_id_fk'
    `);
    expect(fk).toEqual([expect.objectContaining({ confdeltype: 'n' })]);
  });
});
