import type { CrudEntry, ProjectPatchColumns } from '@todoist-clone/contracts';
import { and, eq, schema, sql } from '@todoist-clone/database';
import {
  duplicateProjectNameError,
  ForbiddenError,
  isUniqueViolation,
  PROJECTS_NAME_UNIQUE,
} from './errors.js';
import type { UploadExecutor } from './types.js';

const { projects, tasks } = schema;

type ProjectEntry = Extract<CrudEntry, { table: 'projects' }>;

export async function applyProjectOperation(
  tx: UploadExecutor,
  userId: string,
  operation: ProjectEntry,
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
  operation: Extract<ProjectEntry, { op: 'PUT' }>,
): Promise<void> {
  const { opData } = operation;
  try {
    const written = await tx
      .insert(projects)
      .values({
        id: operation.id,
        userId,
        name: opData.name,
        color: opData.color,
        isFavorite: opData.is_favorite,
        sortOrder: opData.sort_order,
        isArchived: opData.is_archived,
        createdAt: opData.created_at,
        updatedAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: projects.id,
        set: {
          name: opData.name,
          color: opData.color,
          isFavorite: opData.is_favorite,
          sortOrder: opData.sort_order,
          isArchived: opData.is_archived,
          createdAt: opData.created_at,
          updatedAt: sql`now()`,
        },
        setWhere: eq(projects.userId, userId),
      })
      .returning({ id: projects.id });

    if (written.length === 0) {
      throw new ForbiddenError();
    }
  } catch (error) {
    if (error instanceof ForbiddenError) throw error;
    if (isUniqueViolation(error, PROJECTS_NAME_UNIQUE)) {
      throw duplicateProjectNameError();
    }
    throw error;
  }
}

async function applyPatch(
  tx: UploadExecutor,
  userId: string,
  operation: Extract<ProjectEntry, { op: 'PATCH' }>,
): Promise<void> {
  const set = patchSet(operation.opData);
  if (set === null) {
    return;
  }

  try {
    const updated = await tx
      .update(projects)
      .set(set)
      .where(and(eq(projects.id, operation.id), eq(projects.userId, userId)))
      .returning({ id: projects.id });

    if (updated.length === 0) {
      await assertMissingOrOwned(tx, operation.id, userId);
    }
  } catch (error) {
    if (error instanceof ForbiddenError) throw error;
    if (isUniqueViolation(error, PROJECTS_NAME_UNIQUE)) {
      throw duplicateProjectNameError();
    }
    throw error;
  }
}

async function applyDelete(
  tx: UploadExecutor,
  userId: string,
  operation: Extract<ProjectEntry, { op: 'DELETE' }>,
): Promise<void> {
  const [existing] = await tx
    .select({ userId: projects.userId })
    .from(projects)
    .where(eq(projects.id, operation.id))
    .limit(1)
    .for('update');

  if (!existing) {
    return;
  }
  if (existing.userId !== userId) {
    throw new ForbiddenError();
  }

  // Lock members before clearing so a concurrent move cannot race the SET NULL.
  await tx
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.projectId, operation.id), eq(tasks.userId, userId)))
    .for('update');

  await tx
    .update(tasks)
    .set({ projectId: null, updatedAt: sql`now()` })
    .where(and(eq(tasks.projectId, operation.id), eq(tasks.userId, userId)));

  await tx.delete(projects).where(and(eq(projects.id, operation.id), eq(projects.userId, userId)));
}

async function assertMissingOrOwned(tx: UploadExecutor, id: string, userId: string): Promise<void> {
  const [existing] = await tx
    .select({ userId: projects.userId })
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);

  if (existing && existing.userId !== userId) {
    throw new ForbiddenError();
  }
}

function patchSet(opData: ProjectPatchColumns) {
  const set: {
    name?: string;
    color?: string;
    isFavorite?: boolean;
    sortOrder?: number;
    isArchived?: boolean;
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
  if (opData.sort_order !== undefined) {
    set.sortOrder = opData.sort_order;
    hasColumn = true;
  }
  if (opData.is_archived !== undefined) {
    set.isArchived = opData.is_archived;
    hasColumn = true;
  }
  if (opData.created_at !== undefined) {
    set.createdAt = opData.created_at;
    hasColumn = true;
  }

  return hasColumn ? set : null;
}
