import type { CrudEntry, TaskPatchColumns } from '@todoist-clone/contracts';
import { and, type Database, eq, schema, sql } from '@todoist-clone/database';

const { tasks } = schema;

export class ForbiddenError extends Error {
  readonly code = 'forbidden' as const;

  constructor() {
    super('forbidden');
    this.name = 'ForbiddenError';
  }
}

type UploadExecutor = Pick<Database, 'insert' | 'update' | 'delete' | 'select'>;

export async function applyUpload(
  tx: UploadExecutor,
  userId: string,
  operations: CrudEntry[],
): Promise<void> {
  for (const operation of operations) {
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
}

async function applyPut(
  tx: UploadExecutor,
  userId: string,
  operation: Extract<CrudEntry, { op: 'PUT' }>,
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
  operation: Extract<CrudEntry, { op: 'PATCH' }>,
): Promise<void> {
  const set = patchSet(operation.opData);
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

async function applyDelete(
  tx: UploadExecutor,
  userId: string,
  operation: Extract<CrudEntry, { op: 'DELETE' }>,
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
  if (opData.created_at !== undefined) {
    set.createdAt = opData.created_at;
    hasColumn = true;
  }

  return hasColumn ? set : null;
}
