import type { CrudEntry, LabelPatchColumns } from '@todoist-clone/contracts';
import { and, eq, schema, sql } from '@todoist-clone/database';
import {
  duplicateLabelNameError,
  ForbiddenError,
  isUniqueViolation,
  LABELS_NAME_UNIQUE,
} from './errors.js';
import type { UploadExecutor } from './types.js';

const { labels } = schema;

type LabelEntry = Extract<CrudEntry, { table: 'labels' }>;

export async function applyLabelOperation(
  tx: UploadExecutor,
  userId: string,
  operation: LabelEntry,
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
  operation: Extract<LabelEntry, { op: 'PUT' }>,
): Promise<void> {
  const { opData } = operation;
  try {
    const written = await tx
      .insert(labels)
      .values({
        id: operation.id,
        userId,
        name: opData.name,
        color: opData.color,
        isFavorite: opData.is_favorite,
        createdAt: opData.created_at,
        updatedAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: labels.id,
        set: {
          name: opData.name,
          color: opData.color,
          isFavorite: opData.is_favorite,
          createdAt: opData.created_at,
          updatedAt: sql`now()`,
        },
        setWhere: eq(labels.userId, userId),
      })
      .returning({ id: labels.id });

    if (written.length === 0) {
      throw new ForbiddenError();
    }
  } catch (error) {
    if (error instanceof ForbiddenError) throw error;
    if (isUniqueViolation(error, LABELS_NAME_UNIQUE)) {
      throw duplicateLabelNameError();
    }
    throw error;
  }
}

async function applyPatch(
  tx: UploadExecutor,
  userId: string,
  operation: Extract<LabelEntry, { op: 'PATCH' }>,
): Promise<void> {
  const set = patchSet(operation.opData);
  if (set === null) {
    return;
  }

  try {
    const updated = await tx
      .update(labels)
      .set(set)
      .where(and(eq(labels.id, operation.id), eq(labels.userId, userId)))
      .returning({ id: labels.id });

    if (updated.length === 0) {
      await assertMissingOrOwned(tx, operation.id, userId);
    }
  } catch (error) {
    if (error instanceof ForbiddenError) throw error;
    if (isUniqueViolation(error, LABELS_NAME_UNIQUE)) {
      throw duplicateLabelNameError();
    }
    throw error;
  }
}

async function applyDelete(
  tx: UploadExecutor,
  userId: string,
  operation: Extract<LabelEntry, { op: 'DELETE' }>,
): Promise<void> {
  const deleted = await tx
    .delete(labels)
    .where(and(eq(labels.id, operation.id), eq(labels.userId, userId)))
    .returning({ id: labels.id });

  if (deleted.length === 0) {
    await assertMissingOrOwned(tx, operation.id, userId);
  }
}

async function assertMissingOrOwned(tx: UploadExecutor, id: string, userId: string): Promise<void> {
  const [existing] = await tx
    .select({ userId: labels.userId })
    .from(labels)
    .where(eq(labels.id, id))
    .limit(1);

  if (existing && existing.userId !== userId) {
    throw new ForbiddenError();
  }
}

function patchSet(opData: LabelPatchColumns) {
  const set: {
    name?: string;
    color?: string;
    isFavorite?: boolean;
    createdAt?: string;
    updatedAt: ReturnType<typeof sql>;
  } = { updatedAt: sql`now()` };

  let hasColumn = false;
  if (opData.name !== undefined) {
    set.name = opData.name;
    hasColumn = true;
  }
  if (opData.color !== undefined) {
    set.color = opData.color;
    hasColumn = true;
  }
  if (opData.is_favorite !== undefined) {
    set.isFavorite = opData.is_favorite;
    hasColumn = true;
  }
  if (opData.created_at !== undefined) {
    set.createdAt = opData.created_at;
    hasColumn = true;
  }

  return hasColumn ? set : null;
}
