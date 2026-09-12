import { describe, expect, it } from 'vitest';
import { loadTask, OTHER_ID, OWNER_ID, putOp, upload } from './setup.js';

const OWN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_TASK_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MISSING_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

describe('POST /sync/upload (integration)', () => {
  it('PUT inserts and sets user_id from the JWT, ignoring opData.user_id', async () => {
    const response = await upload(OWNER_ID, [
      putOp(OWN_ID, { title: 'From owner', user_id: OTHER_ID }),
    ]);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ applied: 1 });

    const row = await loadTask(OWN_ID);
    expect(row).toMatchObject({
      id: OWN_ID,
      userId: OWNER_ID,
      title: 'From owner',
    });
  });

  it('PUT of own existing row replaces it and bumps updated_at', async () => {
    await upload(OWNER_ID, [putOp(OWN_ID, { title: 'First' })]);
    const before = await loadTask(OWN_ID);
    if (!before) throw new Error('expected row');

    const response = await upload(OWNER_ID, [putOp(OWN_ID, { title: 'Second', priority: 1 })]);
    expect(response.statusCode).toBe(200);

    const after = await loadTask(OWN_ID);
    if (!after) throw new Error('expected row');
    expect(after.title).toBe('Second');
    expect(after.priority).toBe(1);
    expect(after.updatedAt >= before.updatedAt).toBe(true);
    expect(after.updatedAt !== before.createdAt || after.title === 'Second').toBe(true);
  });

  it("PUT of another user's id returns 403 and leaves the row unchanged", async () => {
    await upload(OTHER_ID, [putOp(OTHER_TASK_ID, { title: 'Other' })]);

    const response = await upload(OWNER_ID, [putOp(OTHER_TASK_ID, { title: 'Stolen' })]);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'forbidden' });

    const row = await loadTask(OTHER_TASK_ID);
    expect(row?.title).toBe('Other');
    expect(row?.userId).toBe(OTHER_ID);
  });

  it('PATCH updates own row', async () => {
    await upload(OWNER_ID, [putOp(OWN_ID, { title: 'Before' })]);

    const response = await upload(OWNER_ID, [
      { clientId: 2, op: 'PATCH', table: 'tasks', id: OWN_ID, opData: { title: 'After' } },
    ]);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ applied: 1 });
    expect((await loadTask(OWN_ID))?.title).toBe('After');
  });

  it("PATCH of another user's row returns 403", async () => {
    await upload(OTHER_ID, [putOp(OTHER_TASK_ID, { title: 'Other' })]);

    const response = await upload(OWNER_ID, [
      { clientId: 2, op: 'PATCH', table: 'tasks', id: OTHER_TASK_ID, opData: { title: 'Nope' } },
    ]);
    expect(response.statusCode).toBe(403);
    expect((await loadTask(OTHER_TASK_ID))?.title).toBe('Other');
  });

  it('PATCH of a missing row is a no-op 200', async () => {
    const response = await upload(OWNER_ID, [
      { clientId: 2, op: 'PATCH', table: 'tasks', id: MISSING_ID, opData: { title: 'Ghost' } },
    ]);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ applied: 1 });
    expect(await loadTask(MISSING_ID)).toBeNull();
  });

  it('DELETE removes own row', async () => {
    await upload(OWNER_ID, [putOp(OWN_ID)]);
    const response = await upload(OWNER_ID, [
      { clientId: 3, op: 'DELETE', table: 'tasks', id: OWN_ID, opData: null },
    ]);
    expect(response.statusCode).toBe(200);
    expect(await loadTask(OWN_ID)).toBeNull();
  });

  it("DELETE of another user's row returns 403", async () => {
    await upload(OTHER_ID, [putOp(OTHER_TASK_ID)]);
    const response = await upload(OWNER_ID, [
      { clientId: 3, op: 'DELETE', table: 'tasks', id: OTHER_TASK_ID, opData: null },
    ]);
    expect(response.statusCode).toBe(403);
    expect(await loadTask(OTHER_TASK_ID)).not.toBeNull();
  });

  it('DELETE of a missing row is a no-op 200', async () => {
    const response = await upload(OWNER_ID, [
      { clientId: 3, op: 'DELETE', table: 'tasks', id: MISSING_ID, opData: null },
    ]);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ applied: 1 });
  });

  it('rolls back the whole batch when a later op is forbidden', async () => {
    await upload(OTHER_ID, [putOp(OTHER_TASK_ID, { title: 'Other' })]);

    const response = await upload(OWNER_ID, [
      putOp(OWN_ID, { title: 'Should not stick' }),
      { clientId: 2, op: 'PATCH', table: 'tasks', id: OTHER_TASK_ID, opData: { title: 'Nope' } },
    ]);
    expect(response.statusCode).toBe(403);
    expect(await loadTask(OWN_ID)).toBeNull();
    expect((await loadTask(OTHER_TASK_ID))?.title).toBe('Other');
  });

  it('rejects priority 5 at Zod (never hits CHECK)', async () => {
    const response = await upload(OWNER_ID, [putOp(OWN_ID, { priority: 5 })]);
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('invalid-request');
    expect(await loadTask(OWN_ID)).toBeNull();
  });

  it('rejects a time without a date', async () => {
    const response = await upload(OWNER_ID, [putOp(OWN_ID, { scheduled_time: '09:30' })]);
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('invalid-request');
  });

  it('PATCH of only scheduled_time on a dated row succeeds', async () => {
    await upload(OWNER_ID, [
      putOp(OWN_ID, { scheduled_date: '2026-09-11', scheduled_time: '09:00' }),
    ]);

    const response = await upload(OWNER_ID, [
      {
        clientId: 2,
        op: 'PATCH',
        table: 'tasks',
        id: OWN_ID,
        opData: { scheduled_time: '10:30' },
      },
    ]);
    expect(response.statusCode).toBe(200);
    const row = await loadTask(OWN_ID);
    expect(row?.scheduledDate).toBe('2026-09-11');
    expect(row?.scheduledTime?.startsWith('10:30')).toBe(true);
  });

  it('PATCH that clears scheduled_date also clears a leftover scheduled_time', async () => {
    await upload(OWNER_ID, [
      putOp(OWN_ID, { scheduled_date: '2026-09-11', scheduled_time: '09:00' }),
    ]);

    const response = await upload(OWNER_ID, [
      {
        clientId: 2,
        op: 'PATCH',
        table: 'tasks',
        id: OWN_ID,
        opData: { scheduled_date: null },
      },
    ]);
    expect(response.statusCode).toBe(200);
    const row = await loadTask(OWN_ID);
    expect(row?.scheduledDate).toBeNull();
    expect(row?.scheduledTime).toBeNull();
  });

  it('PATCH of scheduled_time onto a dateless row is 400', async () => {
    await upload(OWNER_ID, [putOp(OWN_ID)]);

    const response = await upload(OWNER_ID, [
      {
        clientId: 2,
        op: 'PATCH',
        table: 'tasks',
        id: OWN_ID,
        opData: { scheduled_time: '09:00' },
      },
    ]);
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('invalid-request');
    expect((await loadTask(OWN_ID))?.scheduledTime).toBeNull();
  });

  it('ignores PATCH user_id and treats an empty-after-strip patch as a no-op', async () => {
    await upload(OWNER_ID, [putOp(OWN_ID, { title: 'Stay' })]);
    const response = await upload(OWNER_ID, [
      { clientId: 2, op: 'PATCH', table: 'tasks', id: OWN_ID, opData: { user_id: OTHER_ID } },
    ]);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ applied: 1 });
    const row = await loadTask(OWN_ID);
    expect(row?.title).toBe('Stay');
    expect(row?.userId).toBe(OWNER_ID);
  });

  it('strips id, user_id and updated_at on PUT and still returns 200', async () => {
    const response = await upload(OWNER_ID, [
      putOp(OWN_ID, {
        id: MISSING_ID,
        user_id: OTHER_ID,
        updated_at: '2000-01-01T00:00:00.000Z',
        title: 'Kept',
      }),
    ]);
    expect(response.statusCode).toBe(200);
    const row = await loadTask(OWN_ID);
    expect(row?.title).toBe('Kept');
    expect(row?.userId).toBe(OWNER_ID);
    expect(row?.updatedAt.startsWith('2000-01-01')).toBe(false);
  });

  it('PUT with omitted completed_at stores an active task', async () => {
    const response = await upload(OWNER_ID, [putOp(OWN_ID, { title: 'Active' })]);
    expect(response.statusCode).toBe(200);
    expect((await loadTask(OWN_ID))?.completedAt).toBeNull();
  });

  it('PUT with completed_at stores the client timestamp', async () => {
    const completedAt = '2026-09-11T15:00:00.000Z';
    const response = await upload(OWNER_ID, [putOp(OWN_ID, { completed_at: completedAt })]);
    expect(response.statusCode).toBe(200);
    const row = await loadTask(OWN_ID);
    expect(row?.completedAt).toBe(completedAt);
    expect(row?.scheduledDate).toBeNull();
  });

  it('PATCH completed_at completes and explicit null reopens without clearing other fields', async () => {
    await upload(OWNER_ID, [
      putOp(OWN_ID, {
        title: 'Keep me',
        description: 'Notes',
        priority: 2,
        scheduled_date: '2026-09-11',
        scheduled_time: '09:00',
      }),
    ]);

    const completedAt = '2026-09-11T16:00:00.000Z';
    const complete = await upload(OWNER_ID, [
      {
        clientId: 2,
        op: 'PATCH',
        table: 'tasks',
        id: OWN_ID,
        opData: { completed_at: completedAt },
      },
    ]);
    expect(complete.statusCode).toBe(200);
    const completed = await loadTask(OWN_ID);
    expect(completed).toMatchObject({
      title: 'Keep me',
      description: 'Notes',
      priority: 2,
      scheduledDate: '2026-09-11',
      completedAt,
    });
    expect(completed?.scheduledTime?.startsWith('09:00')).toBe(true);

    const reopen = await upload(OWNER_ID, [
      {
        clientId: 3,
        op: 'PATCH',
        table: 'tasks',
        id: OWN_ID,
        opData: { completed_at: null },
      },
    ]);
    expect(reopen.statusCode).toBe(200);
    const reopened = await loadTask(OWN_ID);
    expect(reopened?.completedAt).toBeNull();
    expect(reopened?.title).toBe('Keep me');
    expect(reopened?.scheduledDate).toBe('2026-09-11');
    expect(reopened?.scheduledTime?.startsWith('09:00')).toBe(true);
  });

  it('PATCH of title does not change completed_at', async () => {
    const completedAt = '2026-09-11T16:00:00.000Z';
    await upload(OWNER_ID, [putOp(OWN_ID, { title: 'Before', completed_at: completedAt })]);

    const response = await upload(OWNER_ID, [
      { clientId: 2, op: 'PATCH', table: 'tasks', id: OWN_ID, opData: { title: 'After' } },
    ]);
    expect(response.statusCode).toBe(200);
    const row = await loadTask(OWN_ID);
    expect(row?.title).toBe('After');
    expect(row?.completedAt).toBe(completedAt);
  });

  it("PATCH of another user's completed_at returns 403 and rolls back earlier PUTs", async () => {
    await upload(OTHER_ID, [putOp(OTHER_TASK_ID, { title: 'Other' })]);

    const response = await upload(OWNER_ID, [
      putOp(OWN_ID, { title: 'Should not stick' }),
      {
        clientId: 2,
        op: 'PATCH',
        table: 'tasks',
        id: OTHER_TASK_ID,
        opData: { completed_at: '2026-09-11T16:00:00.000Z' },
      },
    ]);
    expect(response.statusCode).toBe(403);
    expect(await loadTask(OWN_ID)).toBeNull();
    expect((await loadTask(OTHER_TASK_ID))?.completedAt).toBeNull();
  });

  it('applies ordered DELETE then restore PUT, including a retry of the same batch', async () => {
    await upload(OWNER_ID, [
      putOp(OWN_ID, {
        title: 'Original',
        description: 'Keep',
        priority: 1,
        scheduled_date: '2026-09-11',
        scheduled_time: '14:30',
        completed_at: '2026-09-11T15:00:00.000Z',
        created_at: '2026-09-10T12:00:00.000Z',
      }),
    ]);

    const restoreBatch = [
      { clientId: 2, op: 'DELETE' as const, table: 'tasks' as const, id: OWN_ID, opData: null },
      putOp(
        OWN_ID,
        {
          title: 'Original',
          description: 'Keep',
          priority: 1,
          scheduled_date: '2026-09-11',
          scheduled_time: '14:30',
          completed_at: '2026-09-11T15:00:00.000Z',
          created_at: '2026-09-10T12:00:00.000Z',
        },
        3,
      ),
    ];

    const first = await upload(OWNER_ID, restoreBatch);
    expect(first.statusCode).toBe(200);
    const restored = await loadTask(OWN_ID);
    expect(restored).toMatchObject({
      id: OWN_ID,
      userId: OWNER_ID,
      title: 'Original',
      description: 'Keep',
      priority: 1,
      scheduledDate: '2026-09-11',
      completedAt: '2026-09-11T15:00:00.000Z',
      createdAt: '2026-09-10T12:00:00.000Z',
    });
    expect(restored?.scheduledTime?.startsWith('14:30')).toBe(true);

    const retry = await upload(OWNER_ID, restoreBatch, 9);
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual({ applied: 2 });
    const afterRetry = await loadTask(OWN_ID);
    expect(afterRetry?.title).toBe('Original');
    expect(afterRetry?.completedAt).toBe('2026-09-11T15:00:00.000Z');
    expect(afterRetry?.createdAt).toBe('2026-09-10T12:00:00.000Z');
  });

  it('PUT restore accepts PowerSync space-separated created_at and completed_at', async () => {
    await upload(OWNER_ID, [putOp(OWN_ID, { title: 'Original' })]);

    const createdAt = '2026-09-10 12:00:00.000Z';
    const completedAt = '2026-09-11 15:00:00.000000Z';
    const response = await upload(OWNER_ID, [
      { clientId: 2, op: 'DELETE', table: 'tasks', id: OWN_ID, opData: null },
      putOp(
        OWN_ID,
        {
          title: 'Original',
          completed_at: completedAt,
          created_at: createdAt,
        },
        3,
      ),
    ]);
    expect(response.statusCode).toBe(200);

    const row = await loadTask(OWN_ID);
    if (!row) throw new Error('expected row');
    expect(row.title).toBe('Original');
    expect(new Date(row.createdAt).getTime()).toBe(new Date('2026-09-10T12:00:00.000Z').getTime());
    if (row.completedAt == null) throw new Error('expected completed_at');
    expect(new Date(row.completedAt).getTime()).toBe(
      new Date('2026-09-11T15:00:00.000Z').getTime(),
    );
  });

  it("PUT restore of another user's id returns 403 and leaves the row unchanged", async () => {
    await upload(OTHER_ID, [putOp(OTHER_TASK_ID, { title: 'Other' })]);

    const response = await upload(OWNER_ID, [
      { clientId: 2, op: 'DELETE', table: 'tasks', id: OTHER_TASK_ID, opData: null },
      putOp(OTHER_TASK_ID, { title: 'Stolen restore' }, 3),
    ]);
    expect(response.statusCode).toBe(403);
    const row = await loadTask(OTHER_TASK_ID);
    expect(row?.title).toBe('Other');
    expect(row?.userId).toBe(OTHER_ID);
  });
});
