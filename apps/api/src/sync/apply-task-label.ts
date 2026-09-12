import type { CrudEntry } from '@todoist-clone/contracts';
import { and, eq, schema } from '@todoist-clone/database';
import { ForbiddenError } from './errors.js';
import type { UploadExecutor } from './types.js';

const { labels, taskLabels, tasks } = schema;

type TaskLabelEntry = Extract<CrudEntry, { table: 'task_labels' }>;

export async function applyTaskLabelOperation(
  tx: UploadExecutor,
  userId: string,
  operation: TaskLabelEntry,
): Promise<void> {
  switch (operation.op) {
    case 'PUT':
      await applyPut(tx, userId, operation);
      break;
    case 'DELETE':
      await applyDelete(tx, userId, operation);
      break;
  }
}

async function applyPut(
  tx: UploadExecutor,
  userId: string,
  operation: Extract<TaskLabelEntry, { op: 'PUT' }>,
): Promise<void> {
  const { task_id: taskId, label_id: labelId, created_at: createdAt } = operation.opData;

  // Lock both ends so a concurrent delete cannot pass the owner check then fail the FK.
  const [task] = await tx
    .select({ userId: tasks.userId })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1)
    .for('update');
  if (!task || task.userId !== userId) {
    throw new ForbiddenError();
  }

  const [label] = await tx
    .select({ userId: labels.userId })
    .from(labels)
    .where(eq(labels.id, labelId))
    .limit(1)
    .for('update');
  if (!label || label.userId !== userId) {
    throw new ForbiddenError();
  }

  const [existingById] = await tx
    .select({ userId: taskLabels.userId })
    .from(taskLabels)
    .where(eq(taskLabels.id, operation.id))
    .limit(1)
    .for('update');
  if (existingById && existingById.userId !== userId) {
    throw new ForbiddenError();
  }

  // Pre-check the pair unique key: a 23505 inside postgres.js begin() is
  // unrecoverable, and a duplicate pair must keep the existing link id.
  const [existingPair] = await tx
    .select({ id: taskLabels.id })
    .from(taskLabels)
    .where(
      and(
        eq(taskLabels.taskId, taskId),
        eq(taskLabels.labelId, labelId),
        eq(taskLabels.userId, userId),
      ),
    )
    .limit(1)
    .for('update');
  if (existingPair && existingPair.id !== operation.id) {
    return;
  }

  const written = await tx
    .insert(taskLabels)
    .values({
      id: operation.id,
      userId,
      taskId,
      labelId,
      createdAt,
    })
    .onConflictDoUpdate({
      target: taskLabels.id,
      set: {
        taskId,
        labelId,
        createdAt,
      },
      setWhere: eq(taskLabels.userId, userId),
    })
    .returning({ id: taskLabels.id });

  if (written.length === 0) {
    throw new ForbiddenError();
  }
}

async function applyDelete(
  tx: UploadExecutor,
  userId: string,
  operation: Extract<TaskLabelEntry, { op: 'DELETE' }>,
): Promise<void> {
  const deleted = await tx
    .delete(taskLabels)
    .where(and(eq(taskLabels.id, operation.id), eq(taskLabels.userId, userId)))
    .returning({ id: taskLabels.id });

  if (deleted.length === 0) {
    await assertMissingOrOwned(tx, operation.id, userId);
  }
}

async function assertMissingOrOwned(tx: UploadExecutor, id: string, userId: string): Promise<void> {
  const [existing] = await tx
    .select({ userId: taskLabels.userId })
    .from(taskLabels)
    .where(eq(taskLabels.id, id))
    .limit(1);

  if (existing && existing.userId !== userId) {
    throw new ForbiddenError();
  }
}
