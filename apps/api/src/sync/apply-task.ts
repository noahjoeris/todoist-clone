import {
  type CrudEntry,
  mergeScheduledColumns,
  type TaskPatchColumns,
} from '@todoist-clone/contracts';
import { and, eq, schema, sql } from '@todoist-clone/database';
import { ForbiddenError, InvalidRequestError } from './errors.js';
import type { UploadExecutor } from './types.js';

const { tasks } = schema;

type TaskEntry = Extract<CrudEntry, { table: 'tasks' }>;

export async function applyTaskOperation(
  tx: UploadExecutor,
  userId: string,
  operation: TaskEntry,
): Promise<void> {
  switch (operation.op) {
    case 'PUT':
      await applyPut(tx, userId, operation);
      break;
    case 'PATCH':
      await applyPatch(tx, userId, operation);
      break;
    case 'DELETE':
      await applyDelete(tx, userId, operation);
      break;
  }
}

async function applyPut(
  tx: UploadExecutor,
  userId: string,
  operation: Extract<TaskEntry, { op: 'PUT' }>,
): Promise<void> {
  const { opData } = operation;
  const written = await tx
    .insert(tasks)
    .values({
      id: operation.id,
      userId,
      title: opData.title,
      description: opData.description,
      priority: opData.priority,
      scheduledDate: opData.scheduled_date ?? null,
      scheduledTime: opData.scheduled_time ?? null,
      completedAt: opData.completed_at ?? null,
      createdAt: opData.created_at,
      updatedAt: sql`now()`,
    })
    .onConflictDoUpdate({
      target: tasks.id,
      set: {
        title: opData.title,
        description: opData.description,
        priority: opData.priority,
        scheduledDate: opData.scheduled_date ?? null,
        scheduledTime: opData.scheduled_time ?? null,
        completedAt: opData.completed_at ?? null,
        createdAt: opData.created_at,
        updatedAt: sql`now()`,
      },
      setWhere: eq(tasks.userId, userId),
    })
    .returning({ id: tasks.id });

  if (written.length === 0) {
    throw new ForbiddenError();
  }
}

async function applyPatch(
  tx: UploadExecutor,
  userId: string,
  operation: Extract<TaskEntry, { op: 'PATCH' }>,
): Promise<void> {
  const opData = await mergeSchedulePatch(tx, userId, operation);
  if (opData === null) {
    return;
  }

  const set = patchSet(opData);
  if (set === null) {
    return;
  }

  const updated = await tx
    .update(tasks)
    .set(set)
    .where(and(eq(tasks.id, operation.id), eq(tasks.userId, userId)))
    .returning({ id: tasks.id });

  if (updated.length === 0) {
    await assertMissingOrOwned(tx, operation.id, userId);
  }
}

/** Date/time are coupled; validate the merged stored row, not the partial patch. */
async function mergeSchedulePatch(
  tx: UploadExecutor,
  userId: string,
  operation: Extract<TaskEntry, { op: 'PATCH' }>,
): Promise<TaskPatchColumns | null> {
  const { opData } = operation;
  if (opData.scheduled_date === undefined && opData.scheduled_time === undefined) {
    return opData;
  }

  // Lock until this transaction's UPDATE so a concurrent PATCH cannot stale the merge.
  const [existing] = await tx
    .select({
      userId: tasks.userId,
      scheduledDate: tasks.scheduledDate,
      scheduledTime: tasks.scheduledTime,
    })
    .from(tasks)
    .where(eq(tasks.id, operation.id))
    .limit(1)
    .for('update');

  if (!existing) {
    return null;
  }
  if (existing.userId !== userId) {
    throw new ForbiddenError();
  }

  const merged = mergeScheduledColumns(
    {
      scheduled_date: existing.scheduledDate ?? null,
      scheduled_time: existing.scheduledTime ?? null,
    },
    opData,
  );
  if (!merged.ok) {
    throw new InvalidRequestError([
      { path: 'scheduled_time', message: 'scheduled_time requires scheduled_date' },
    ]);
  }

  return {
    ...opData,
    scheduled_date: merged.scheduled_date,
    scheduled_time: merged.scheduled_time,
  };
}

async function applyDelete(
  tx: UploadExecutor,
  userId: string,
  operation: Extract<TaskEntry, { op: 'DELETE' }>,
): Promise<void> {
  const deleted = await tx
    .delete(tasks)
    .where(and(eq(tasks.id, operation.id), eq(tasks.userId, userId)))
    .returning({ id: tasks.id });

  if (deleted.length === 0) {
    await assertMissingOrOwned(tx, operation.id, userId);
  }
}

async function assertMissingOrOwned(tx: UploadExecutor, id: string, userId: string): Promise<void> {
  const [existing] = await tx
    .select({ userId: tasks.userId })
    .from(tasks)
    .where(eq(tasks.id, id))
    .limit(1);

  if (existing && existing.userId !== userId) {
    throw new ForbiddenError();
  }
}

function patchSet(opData: TaskPatchColumns) {
  const set: {
    title?: string;
    description?: string;
    priority?: number;
    scheduledDate?: string | null;
    scheduledTime?: string | null;
    completedAt?: string | null;
    createdAt?: string;
    updatedAt: ReturnType<typeof sql>;
  } = { updatedAt: sql`now()` };

  let hasColumn = false;
  if (opData.title !== undefined) {
    set.title = opData.title;
    hasColumn = true;
  }
  if (opData.description !== undefined) {
    set.description = opData.description;
    hasColumn = true;
  }
  if (opData.priority !== undefined) {
    set.priority = opData.priority;
    hasColumn = true;
  }
  if (opData.scheduled_date !== undefined) {
    set.scheduledDate = opData.scheduled_date;
    hasColumn = true;
  }
  if (opData.scheduled_time !== undefined) {
    set.scheduledTime = opData.scheduled_time;
    hasColumn = true;
  }
  if (opData.completed_at !== undefined) {
    set.completedAt = opData.completed_at;
    hasColumn = true;
  }
  if (opData.created_at !== undefined) {
    set.createdAt = opData.created_at;
    hasColumn = true;
  }

  return hasColumn ? set : null;
}
