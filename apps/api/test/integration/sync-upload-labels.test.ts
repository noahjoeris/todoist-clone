import { sql } from '@todoist-clone/database';
import { describe, expect, it } from 'vitest';
import {
  CASCADE_ID,
  database,
  loadLabel,
  loadTask,
  loadTaskLabel,
  OTHER_ID,
  OWNER_ID,
  putLabelOp,
  putOp,
  putTaskLabelOp,
  upload,
} from './setup.js';

const OWN_TASK = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_TASK = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MISSING_TASK = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OWN_LABEL = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const OTHER_LABEL = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const SECOND_LABEL = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const OWN_LINK = '99999999-9999-4999-8999-999999999999';
const OTHER_LINK = '88888888-8888-4888-8888-888888888888';
const SECOND_LINK = '77777777-7777-4777-8777-777777777777';
const MISSING_LABEL = '66666666-6666-4666-8666-666666666666';

describe('POST /sync/upload labels (integration)', () => {
  it('PUT inserts a label owned by the JWT and ignores opData.user_id', async () => {
    const response = await upload(OWNER_ID, [
      putLabelOp(OWN_LABEL, { name: 'Work', user_id: OTHER_ID }),
    ]);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ applied: 1 });

    const row = await loadLabel(OWN_LABEL);
    expect(row).toMatchObject({
      id: OWN_LABEL,
      userId: OWNER_ID,
      name: 'Work',
      color: 'charcoal',
      isFavorite: false,
    });
  });

  it('normalizes SQLite integer 0/1 favorite values to boolean', async () => {
    const zero = await upload(OWNER_ID, [putLabelOp(OWN_LABEL, { name: 'A', is_favorite: 0 })]);
    expect(zero.statusCode).toBe(200);
    expect((await loadLabel(OWN_LABEL))?.isFavorite).toBe(false);

    const one = await upload(OWNER_ID, [putLabelOp(OWN_LABEL, { name: 'A', is_favorite: 1 })]);
    expect(one.statusCode).toBe(200);
    expect((await loadLabel(OWN_LABEL))?.isFavorite).toBe(true);
  });

  it('PUT of own existing label replaces it, bumps updated_at, and follows the id on rename/recolor', async () => {
    await upload(OWNER_ID, [putLabelOp(OWN_LABEL, { name: 'Work', color: 'red' })]);
    const before = await loadLabel(OWN_LABEL);
    if (!before) throw new Error('expected row');

    const response = await upload(OWNER_ID, [
      putLabelOp(OWN_LABEL, { name: 'Office', color: 'blue', is_favorite: true }),
    ]);
    expect(response.statusCode).toBe(200);
    const after = await loadLabel(OWN_LABEL);
    expect(after).toMatchObject({
      name: 'Office',
      color: 'blue',
      isFavorite: true,
    });
    expect(after && after.updatedAt >= before.updatedAt).toBe(true);
  });

  it("PUT of another user's label id returns 403 and leaves the row unchanged", async () => {
    await upload(OTHER_ID, [putLabelOp(OTHER_LABEL, { name: 'Other' })]);
    const response = await upload(OWNER_ID, [putLabelOp(OTHER_LABEL, { name: 'Stolen' })]);
    expect(response.statusCode).toBe(403);
    expect((await loadLabel(OTHER_LABEL))?.name).toBe('Other');
    expect((await loadLabel(OTHER_LABEL))?.userId).toBe(OTHER_ID);
  });

  it('PATCH updates own label; omitted fields stay unchanged', async () => {
    await upload(OWNER_ID, [
      putLabelOp(OWN_LABEL, { name: 'Work', color: 'red', is_favorite: true }),
    ]);
    const response = await upload(OWNER_ID, [
      { clientId: 2, op: 'PATCH', table: 'labels', id: OWN_LABEL, opData: { name: 'Office' } },
    ]);
    expect(response.statusCode).toBe(200);
    expect(await loadLabel(OWN_LABEL)).toMatchObject({
      name: 'Office',
      color: 'red',
      isFavorite: true,
    });
  });

  it("PATCH of another user's label returns 403", async () => {
    await upload(OTHER_ID, [putLabelOp(OTHER_LABEL, { name: 'Other' })]);
    const response = await upload(OWNER_ID, [
      { clientId: 2, op: 'PATCH', table: 'labels', id: OTHER_LABEL, opData: { name: 'Nope' } },
    ]);
    expect(response.statusCode).toBe(403);
    expect((await loadLabel(OTHER_LABEL))?.name).toBe('Other');
  });

  it('PATCH of a missing label is a no-op 200', async () => {
    const response = await upload(OWNER_ID, [
      { clientId: 2, op: 'PATCH', table: 'labels', id: MISSING_LABEL, opData: { name: 'Ghost' } },
    ]);
    expect(response.statusCode).toBe(200);
    expect(await loadLabel(MISSING_LABEL)).toBeNull();
  });

  it('DELETE removes own label', async () => {
    await upload(OWNER_ID, [putLabelOp(OWN_LABEL)]);
    const response = await upload(OWNER_ID, [
      { clientId: 3, op: 'DELETE', table: 'labels', id: OWN_LABEL, opData: null },
    ]);
    expect(response.statusCode).toBe(200);
    expect(await loadLabel(OWN_LABEL)).toBeNull();
  });

  it("DELETE of another user's label returns 403", async () => {
    await upload(OTHER_ID, [putLabelOp(OTHER_LABEL)]);
    const response = await upload(OWNER_ID, [
      { clientId: 3, op: 'DELETE', table: 'labels', id: OTHER_LABEL, opData: null },
    ]);
    expect(response.statusCode).toBe(403);
    expect(await loadLabel(OTHER_LABEL)).not.toBeNull();
  });

  it('rejects invalid names and colors at Zod', async () => {
    const blank = await upload(OWNER_ID, [putLabelOp(OWN_LABEL, { name: '  ' })]);
    expect(blank.statusCode).toBe(400);
    expect(blank.json().error).toBe('invalid-request');

    const color = await upload(OWNER_ID, [putLabelOp(OWN_LABEL, { color: 'hot_pink' })]);
    expect(color.statusCode).toBe(400);
    expect(await loadLabel(OWN_LABEL)).toBeNull();
  });

  it('rejects a case-insensitive duplicate name with 400 and a name issue', async () => {
    await upload(OWNER_ID, [putLabelOp(OWN_LABEL, { name: 'Work' })]);
    const response = await upload(OWNER_ID, [putLabelOp(SECOND_LABEL, { name: 'WORK' })]);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: 'invalid-request',
      issues: [{ path: 'name' }],
    });
    expect(await loadLabel(SECOND_LABEL)).toBeNull();
  });

  it('rejects renaming onto another label of the same user case-insensitively', async () => {
    await upload(OWNER_ID, [
      putLabelOp(OWN_LABEL, { name: 'Work' }),
      putLabelOp(SECOND_LABEL, { name: 'Personal' }, 2),
    ]);
    const response = await upload(OWNER_ID, [
      { clientId: 3, op: 'PATCH', table: 'labels', id: SECOND_LABEL, opData: { name: 'work' } },
    ]);
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('invalid-request');
    expect((await loadLabel(SECOND_LABEL))?.name).toBe('Personal');
  });

  it('allows renaming the same label to a different casing', async () => {
    await upload(OWNER_ID, [putLabelOp(OWN_LABEL, { name: 'Work' })]);
    const response = await upload(OWNER_ID, [
      { clientId: 2, op: 'PATCH', table: 'labels', id: OWN_LABEL, opData: { name: 'WORK' } },
    ]);
    expect(response.statusCode).toBe(200);
    expect((await loadLabel(OWN_LABEL))?.name).toBe('WORK');
  });

  it('allows the same name for two users', async () => {
    await upload(OWNER_ID, [putLabelOp(OWN_LABEL, { name: 'Work' })]);
    const response = await upload(OTHER_ID, [putLabelOp(OTHER_LABEL, { name: 'Work' })]);
    expect(response.statusCode).toBe(200);
    expect((await loadLabel(OTHER_LABEL))?.userId).toBe(OTHER_ID);
  });
});

describe('POST /sync/upload task_labels (integration)', () => {
  async function seedOwnTaskAndLabel(): Promise<void> {
    const response = await upload(OWNER_ID, [
      putOp(OWN_TASK, { title: 'Task' }),
      putLabelOp(OWN_LABEL, { name: 'Work' }, 2),
    ]);
    expect(response.statusCode).toBe(200);
  }

  it('PUT attaches a label to an owned task', async () => {
    await seedOwnTaskAndLabel();
    const response = await upload(OWNER_ID, [putTaskLabelOp(OWN_LINK, OWN_TASK, OWN_LABEL)]);
    expect(response.statusCode).toBe(200);
    expect(await loadTaskLabel(OWN_LINK)).toMatchObject({
      id: OWN_LINK,
      userId: OWNER_ID,
      taskId: OWN_TASK,
      labelId: OWN_LABEL,
    });
  });

  it('PUT retry of the same association id is idempotent', async () => {
    await seedOwnTaskAndLabel();
    const batch = [putTaskLabelOp(OWN_LINK, OWN_TASK, OWN_LABEL)];
    expect((await upload(OWNER_ID, batch)).statusCode).toBe(200);
    expect((await upload(OWNER_ID, batch, 9)).statusCode).toBe(200);
    expect(await loadTaskLabel(OWN_LINK)).not.toBeNull();
  });

  it('PUT of the same task+label with a different id is a no-op 200', async () => {
    await seedOwnTaskAndLabel();
    await upload(OWNER_ID, [putTaskLabelOp(OWN_LINK, OWN_TASK, OWN_LABEL)]);
    const response = await upload(OWNER_ID, [putTaskLabelOp(SECOND_LINK, OWN_TASK, OWN_LABEL)]);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ applied: 1 });
    expect(await loadTaskLabel(OWN_LINK)).not.toBeNull();
    expect(await loadTaskLabel(SECOND_LINK)).toBeNull();
  });

  it('rejects PATCH of task_labels at validation', async () => {
    await seedOwnTaskAndLabel();
    await upload(OWNER_ID, [putTaskLabelOp(OWN_LINK, OWN_TASK, OWN_LABEL)]);
    const response = await upload(OWNER_ID, [
      {
        clientId: 2,
        op: 'PATCH',
        table: 'task_labels',
        id: OWN_LINK,
        opData: { task_id: OWN_TASK },
      },
    ]);
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('invalid-request');
  });

  it('DELETE detaches an owned association', async () => {
    await seedOwnTaskAndLabel();
    await upload(OWNER_ID, [putTaskLabelOp(OWN_LINK, OWN_TASK, OWN_LABEL)]);
    const response = await upload(OWNER_ID, [
      { clientId: 3, op: 'DELETE', table: 'task_labels', id: OWN_LINK, opData: null },
    ]);
    expect(response.statusCode).toBe(200);
    expect(await loadTaskLabel(OWN_LINK)).toBeNull();
  });

  it('DELETE of a missing association is a no-op 200', async () => {
    const response = await upload(OWNER_ID, [
      { clientId: 3, op: 'DELETE', table: 'task_labels', id: OWN_LINK, opData: null },
    ]);
    expect(response.statusCode).toBe(200);
  });

  it('rejects a link to a missing task with 403, not a 500', async () => {
    await upload(OWNER_ID, [putLabelOp(OWN_LABEL)]);
    const response = await upload(OWNER_ID, [putTaskLabelOp(OWN_LINK, MISSING_TASK, OWN_LABEL)]);
    expect(response.statusCode).toBe(403);
    expect(await loadTaskLabel(OWN_LINK)).toBeNull();
  });

  it("rejects attaching another user's label to an owned task", async () => {
    await upload(OWNER_ID, [putOp(OWN_TASK)]);
    await upload(OTHER_ID, [putLabelOp(OTHER_LABEL, { name: 'Other' })]);
    const response = await upload(OWNER_ID, [putTaskLabelOp(OWN_LINK, OWN_TASK, OTHER_LABEL)]);
    expect(response.statusCode).toBe(403);
    expect(await loadTaskLabel(OWN_LINK)).toBeNull();
  });

  it("rejects attaching an owned label to another user's task", async () => {
    await upload(OWNER_ID, [putLabelOp(OWN_LABEL)]);
    await upload(OTHER_ID, [putOp(OTHER_TASK)]);
    const response = await upload(OWNER_ID, [putTaskLabelOp(OWN_LINK, OTHER_TASK, OWN_LABEL)]);
    expect(response.statusCode).toBe(403);
    expect(await loadTaskLabel(OWN_LINK)).toBeNull();
  });

  it("PUT of another user's association id returns 403 and does not retarget it", async () => {
    await upload(OTHER_ID, [
      putOp(OTHER_TASK),
      putLabelOp(OTHER_LABEL, { name: 'Other' }, 2),
      putTaskLabelOp(OTHER_LINK, OTHER_TASK, OTHER_LABEL, {}, 3),
    ]);
    await seedOwnTaskAndLabel();

    const response = await upload(OWNER_ID, [putTaskLabelOp(OTHER_LINK, OWN_TASK, OWN_LABEL)]);
    expect(response.statusCode).toBe(403);
    const row = await loadTaskLabel(OTHER_LINK);
    expect(row).toMatchObject({
      userId: OTHER_ID,
      taskId: OTHER_TASK,
      labelId: OTHER_LABEL,
    });
  });

  it("DELETE of another user's association returns 403", async () => {
    await upload(OTHER_ID, [
      putOp(OTHER_TASK),
      putLabelOp(OTHER_LABEL, { name: 'Other' }, 2),
      putTaskLabelOp(OTHER_LINK, OTHER_TASK, OTHER_LABEL, {}, 3),
    ]);
    const response = await upload(OWNER_ID, [
      { clientId: 4, op: 'DELETE', table: 'task_labels', id: OTHER_LINK, opData: null },
    ]);
    expect(response.statusCode).toBe(403);
    expect(await loadTaskLabel(OTHER_LINK)).not.toBeNull();
  });

  it('rolls back the whole batch when a later association is forbidden', async () => {
    await upload(OTHER_ID, [putOp(OTHER_TASK), putLabelOp(OTHER_LABEL, { name: 'Other' }, 2)]);
    const response = await upload(OWNER_ID, [
      putLabelOp(OWN_LABEL, { name: 'Should not stick' }),
      putTaskLabelOp(OWN_LINK, OTHER_TASK, OTHER_LABEL, {}, 2),
    ]);
    expect(response.statusCode).toBe(403);
    expect(await loadLabel(OWN_LABEL)).toBeNull();
    expect(await loadTaskLabel(OWN_LINK)).toBeNull();
  });

  it('applies labels and tasks before a new link in one batch', async () => {
    const response = await upload(OWNER_ID, [
      putLabelOp(OWN_LABEL, { name: 'Work' }),
      putOp(OWN_TASK, { title: 'Task' }, 2),
      putTaskLabelOp(OWN_LINK, OWN_TASK, OWN_LABEL, {}, 3),
    ]);
    expect(response.statusCode).toBe(200);
    expect(await loadTaskLabel(OWN_LINK)).not.toBeNull();
  });

  it('DELETE of a label cascades associations including on completed tasks', async () => {
    await upload(OWNER_ID, [
      putOp(OWN_TASK, { title: 'Done', completed_at: '2026-09-11T15:00:00.000Z' }),
      putLabelOp(OWN_LABEL, { name: 'Work' }, 2),
      putTaskLabelOp(OWN_LINK, OWN_TASK, OWN_LABEL, {}, 3),
    ]);
    expect(await loadTaskLabel(OWN_LINK)).not.toBeNull();

    const response = await upload(OWNER_ID, [
      { clientId: 4, op: 'DELETE', table: 'labels', id: OWN_LABEL, opData: null },
    ]);
    expect(response.statusCode).toBe(200);
    expect(await loadLabel(OWN_LABEL)).toBeNull();
    expect(await loadTaskLabel(OWN_LINK)).toBeNull();
    expect(await loadTask(OWN_TASK)).not.toBeNull();
  });

  it('DELETE of a completed task cascades associations; a later link DELETE is a no-op', async () => {
    await upload(OWNER_ID, [
      putOp(OWN_TASK, { title: 'Done', completed_at: '2026-09-11T15:00:00.000Z' }),
      putLabelOp(OWN_LABEL, { name: 'Work' }, 2),
      putTaskLabelOp(OWN_LINK, OWN_TASK, OWN_LABEL, {}, 3),
    ]);

    const response = await upload(OWNER_ID, [
      { clientId: 4, op: 'DELETE', table: 'tasks', id: OWN_TASK, opData: null },
      { clientId: 5, op: 'DELETE', table: 'task_labels', id: OWN_LINK, opData: null },
    ]);
    expect(response.statusCode).toBe(200);
    expect(await loadTask(OWN_TASK)).toBeNull();
    expect(await loadTaskLabel(OWN_LINK)).toBeNull();
    expect(await loadLabel(OWN_LABEL)).not.toBeNull();
  });

  it('deleting the user cascades tasks, labels, and associations', async () => {
    const taskId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac';
    const labelId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddc';
    const linkId = '99999999-9999-4999-8999-99999999999c';

    const created = await upload(CASCADE_ID, [
      putOp(taskId, { title: 'Cascade' }),
      putLabelOp(labelId, { name: 'Cascade' }, 2),
      putTaskLabelOp(linkId, taskId, labelId, {}, 3),
    ]);
    expect(created.statusCode).toBe(200);

    // Default session role so ON DELETE CASCADE on our user_id FKs actually fires
    // (replica role skips FK triggers).
    await database.db.execute(sql`DELETE FROM auth.users WHERE id = ${CASCADE_ID}::uuid`);

    expect(await loadTask(taskId)).toBeNull();
    expect(await loadLabel(labelId)).toBeNull();
    expect(await loadTaskLabel(linkId)).toBeNull();

    await database.db.execute(sql`SET session_replication_role = replica`);
    await database.db.execute(
      sql`INSERT INTO auth.users (id) VALUES (${CASCADE_ID}::uuid) ON CONFLICT (id) DO NOTHING`,
    );
    await database.db.execute(sql`SET session_replication_role = DEFAULT`);
  });
});

describe('POST /sync/upload labels do not affect existing task semantics', () => {
  it('still applies a tasks-only batch', async () => {
    const response = await upload(OWNER_ID, [putOp(OWN_TASK, { title: 'Still works' })]);
    expect(response.statusCode).toBe(200);
    expect((await loadTask(OWN_TASK))?.title).toBe('Still works');
  });
});
