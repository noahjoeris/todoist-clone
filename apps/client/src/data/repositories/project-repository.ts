import type { CommonPowerSyncDatabase } from '@powersync/common';
import { labelColorSchema } from '@todoist-clone/contracts';
import { z } from 'zod';
import {
  flagToSqlite,
  MAX_PROJECT_SORT_ORDER,
  MAX_UPLOAD_OPERATIONS,
  ProjectDuplicateNameError,
  type ProjectFields,
  type ProjectInput,
  type ProjectListItem,
  ProjectNotFoundError,
  ProjectOperationTooLargeError,
  type ProjectPatch,
  ProjectStaleListError,
  type ProjectSummary,
  parseLabelColor,
  projectInputSchema,
  projectNameSchema,
  projectNamesEqual,
  readSqliteFlag,
  spliceActiveOrder,
} from './project';

export interface ProjectRepository {
  create(input: ProjectInput): Promise<ProjectSummary>;
  update(id: string, patch: ProjectPatch): Promise<void>;
  setArchived(id: string, archived: boolean): Promise<void>;
  /** Reorder the complete visible active-project id sequence. */
  reorder(orderedIds: readonly string[]): Promise<void>;
  delete(id: string): Promise<void>;
  findByName(name: string): Promise<ProjectSummary | null>;
  /** Total tasks in this project, including completed. */
  countAffectedTasks(id: string): Promise<number>;
  subscribe(
    onProjects: (projects: ProjectListItem[]) => void,
    onError: (error: Error) => void,
  ): () => void;
}

export interface ProjectRepositories {
  forUser(userId: string): ProjectRepository;
}

type ProjectDatabase = Pick<
  CommonPowerSyncDatabase,
  'getAll' | 'getOptional' | 'watchWithCallback' | 'writeTransaction'
>;

type ProjectRow = {
  id: string;
  name: string;
  color: string;
  isFavorite?: unknown;
  is_favorite?: unknown;
  isArchived?: unknown;
  is_archived?: unknown;
  sortOrder?: unknown;
  sort_order?: unknown;
  createdAt?: string;
  created_at?: string;
  updatedAt?: string;
  updated_at?: string;
  activeTaskCount?: unknown;
  totalTaskCount?: unknown;
};

type OrderRow = {
  id: string;
  sort_order: number;
  is_archived: unknown;
};

const PROJECT_WATCH_TABLES = ['projects', 'tasks'];

export function createProjectRepositories(
  database: ProjectDatabase,
  generateId: () => string,
): ProjectRepositories {
  const byUser = new Map<string, ProjectRepository>();
  return {
    forUser(userId) {
      const existing = byUser.get(userId);
      if (existing) return existing;
      const repository = createProjectRepository(database, generateId, userId);
      byUser.set(userId, repository);
      return repository;
    },
  };
}

export function createProjectRepository(
  database: ProjectDatabase,
  generateId: () => string,
  userId: string,
): ProjectRepository {
  return {
    async create(input) {
      const fields = projectInputSchema.parse(input);
      const id = generateId();
      const createdAt = new Date().toISOString();
      await database.writeTransaction(async (tx) => {
        await assertNameAvailable(tx, userId, fields.name);
        const sortOrder = await nextAppendOrder(tx, userId);
        await tx.execute(
          `INSERT INTO projects
            (id, user_id, name, color, is_favorite, sort_order, is_archived, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            userId,
            fields.name,
            fields.color,
            flagToSqlite(fields.isFavorite),
            sortOrder,
            0,
            createdAt,
            createdAt,
          ],
        );
      });
      return { id, name: fields.name, color: fields.color, isArchived: false };
    },

    async update(id, patch) {
      const parsed = parsePatch(patch);
      await database.writeTransaction(async (tx) => {
        const current = await readOwnedProject(tx, userId, id);
        if (current === null) throw new ProjectNotFoundError();

        const assignments: string[] = [];
        const params: unknown[] = [];
        if (parsed.name !== undefined && parsed.name !== current.name) {
          await assertNameAvailable(tx, userId, parsed.name, id);
          assignments.push('name = ?');
          params.push(parsed.name);
        }
        if (parsed.color !== undefined && parsed.color !== current.color) {
          assignments.push('color = ?');
          params.push(parsed.color);
        }
        if (parsed.isFavorite !== undefined && parsed.isFavorite !== current.isFavorite) {
          assignments.push('is_favorite = ?');
          params.push(flagToSqlite(parsed.isFavorite));
        }
        if (assignments.length === 0) return;

        assignments.push('updated_at = ?');
        params.push(new Date().toISOString(), id, userId);
        await tx.execute(
          `UPDATE projects SET ${assignments.join(', ')} WHERE id = ? AND user_id = ?`,
          params,
        );
      });
    },

    async setArchived(id, archived) {
      const next = z.boolean().parse(archived);
      await database.writeTransaction(async (tx) => {
        const current = await readOwnedProject(tx, userId, id);
        if (current === null) throw new ProjectNotFoundError();
        if (current.isArchived === next) return;
        await tx.execute(
          `UPDATE projects SET is_archived = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
          [flagToSqlite(next), new Date().toISOString(), id, userId],
        );
      });
    },

    async reorder(orderedIds) {
      const requested = [...orderedIds];
      if (new Set(requested).size !== requested.length) {
        throw new ProjectStaleListError();
      }
      await database.writeTransaction(async (tx) => {
        const owned = await readOwnedOrderRows(tx, userId);
        const active = owned.filter((row) => !readSqliteFlag(row.is_archived));
        const ownedIds = new Set(owned.map((row) => row.id));
        for (const id of requested) {
          if (!ownedIds.has(id)) throw new ProjectNotFoundError();
        }
        const activeIds = new Set(active.map((row) => row.id));
        if (requested.length !== activeIds.size || requested.some((id) => !activeIds.has(id))) {
          throw new ProjectStaleListError();
        }

        const nextSequence = spliceActiveOrder(
          owned.map((row) => ({
            id: row.id,
            isArchived: readSqliteFlag(row.is_archived),
          })),
          requested,
        );
        await writeDenseOrder(
          tx,
          userId,
          owned,
          nextSequence.map((row) => row.id),
        );
      });
    },

    async delete(id) {
      await database.writeTransaction(async (tx) => {
        const current = await readOwnedProject(tx, userId, id);
        if (current === null) throw new ProjectNotFoundError();

        const members = await tx.getAll<{ id: string }>(
          'SELECT id FROM tasks WHERE project_id = ? AND user_id = ?',
          [id, userId],
        );
        if (members.length + 1 > MAX_UPLOAD_OPERATIONS) {
          throw new ProjectOperationTooLargeError(
            'This deletion exceeds the current offline transaction limit. Archive the project instead.',
          );
        }

        const now = new Date().toISOString();
        for (const member of members) {
          await tx.execute(
            'UPDATE tasks SET project_id = NULL, updated_at = ? WHERE id = ? AND user_id = ?',
            [now, member.id, userId],
          );
        }
        await tx.execute('DELETE FROM projects WHERE id = ? AND user_id = ?', [id, userId]);
      });
    },

    async findByName(name) {
      const trimmed = name.trim();
      if (trimmed === '') return null;
      const row = await findOwnedByName(database, userId, trimmed);
      return row ? mapSummary(row) : null;
    },

    async countAffectedTasks(id) {
      const row = await database.getOptional<{ count?: unknown }>(
        'SELECT COUNT(*) AS count FROM tasks WHERE project_id = ? AND user_id = ?',
        [id, userId],
      );
      return Number(row?.count ?? 0);
    },

    subscribe(onProjects, onError) {
      const sql = `SELECT
            p.id,
            p.name,
            p.color,
            p.is_favorite AS isFavorite,
            p.sort_order AS sortOrder,
            p.is_archived AS isArchived,
            p.created_at AS createdAt,
            p.updated_at AS updatedAt,
            COUNT(DISTINCT CASE WHEN t.id IS NOT NULL AND t.completed_at IS NULL THEN t.id END)
              AS activeTaskCount,
            COUNT(DISTINCT t.id) AS totalTaskCount
         FROM projects p
         LEFT JOIN tasks t ON t.project_id = p.id AND t.user_id = p.user_id
         WHERE p.user_id = ?
         GROUP BY p.id, p.name, p.color, p.is_favorite, p.sort_order, p.is_archived,
           p.created_at, p.updated_at
         ORDER BY p.sort_order ASC, p.id ASC`;
      const controller = new AbortController();
      database.watchWithCallback(
        sql,
        [userId],
        {
          onResult: (result) => {
            if (controller.signal.aborted) return;
            onProjects((result.array as ProjectRow[]).map(mapListItem));
          },
          onError: (error) => {
            if (!controller.signal.aborted) onError(error);
          },
        },
        { signal: controller.signal, tables: PROJECT_WATCH_TABLES },
      );
      return () => controller.abort();
    },
  };
}

type ProjectQuery = {
  getAll: CommonPowerSyncDatabase['getAll'];
};

type ProjectTx = ProjectQuery & {
  getOptional: CommonPowerSyncDatabase['getOptional'];
  execute: CommonPowerSyncDatabase['execute'];
};

async function assertNameAvailable(
  tx: ProjectTx,
  userId: string,
  name: string,
  exceptId?: string,
): Promise<void> {
  const row = await findOwnedByName(tx, userId, name, exceptId);
  if (row) throw new ProjectDuplicateNameError();
}

async function findOwnedByName(
  query: ProjectQuery,
  userId: string,
  name: string,
  exceptId?: string,
): Promise<ProjectRow | null> {
  const rows = await query.getAll<ProjectRow>(
    exceptId === undefined
      ? 'SELECT id, name, color, is_archived AS isArchived FROM projects WHERE user_id = ?'
      : 'SELECT id, name, color, is_archived AS isArchived FROM projects WHERE user_id = ? AND id != ?',
    exceptId === undefined ? [userId] : [userId, exceptId],
  );
  return rows.find((row) => projectNamesEqual(row.name, name)) ?? null;
}

async function readOwnedProject(
  tx: ProjectTx,
  userId: string,
  id: string,
): Promise<(ProjectFields & { id: string; isArchived: boolean }) | null> {
  const row = await tx.getOptional<ProjectRow>(
    `SELECT id, name, color, is_favorite AS isFavorite, is_archived AS isArchived
     FROM projects WHERE id = ? AND user_id = ?`,
    [id, userId],
  );
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    color: parseLabelColor(row.color),
    isFavorite: readSqliteFlag(row.isFavorite),
    isArchived: readSqliteFlag(row.isArchived),
  };
}

async function readOwnedOrderRows(tx: ProjectTx, userId: string): Promise<OrderRow[]> {
  return tx.getAll<OrderRow>(
    `SELECT id, sort_order, is_archived
     FROM projects WHERE user_id = ?
     ORDER BY sort_order ASC, id ASC`,
    [userId],
  );
}

async function nextAppendOrder(tx: ProjectTx, userId: string): Promise<number> {
  const maxRow = await tx.getOptional<{ sort_order: unknown }>(
    'SELECT MAX(sort_order) AS sort_order FROM projects WHERE user_id = ?',
    [userId],
  );
  const max = maxRow?.sort_order == null ? null : Number(maxRow.sort_order);
  if (max == null) return 0;
  if (max < MAX_PROJECT_SORT_ORDER) return max + 1;

  const owned = await readOwnedOrderRows(tx, userId);
  await writeDenseOrder(
    tx,
    userId,
    owned,
    owned.map((row) => row.id),
  );
  if (owned.length > MAX_PROJECT_SORT_ORDER) {
    throw new ProjectOperationTooLargeError(
      'This change exceeds the current offline transaction limit.',
    );
  }
  return owned.length;
}

async function writeDenseOrder(
  tx: ProjectTx,
  userId: string,
  current: readonly OrderRow[],
  orderedIds: readonly string[],
): Promise<void> {
  const byId = new Map(current.map((row) => [row.id, row]));
  const changes: Array<{ id: string; sortOrder: number }> = [];
  orderedIds.forEach((id, index) => {
    const row = byId.get(id);
    if (row == null) return;
    if (row.sort_order !== index) changes.push({ id, sortOrder: index });
  });
  if (changes.length > MAX_UPLOAD_OPERATIONS) {
    throw new ProjectOperationTooLargeError(
      'This reorder exceeds the current offline transaction limit.',
    );
  }
  if (changes.length === 0) return;
  const now = new Date().toISOString();
  for (const change of changes) {
    await tx.execute(
      'UPDATE projects SET sort_order = ?, updated_at = ? WHERE id = ? AND user_id = ?',
      [change.sortOrder, now, change.id, userId],
    );
  }
}

function parsePatch(patch: ProjectPatch): ProjectPatch {
  const next: ProjectPatch = {};
  if (patch.name !== undefined) next.name = projectNameSchema.parse(patch.name);
  if (patch.color !== undefined) next.color = labelColorSchema.parse(patch.color);
  if (patch.isFavorite !== undefined) next.isFavorite = z.boolean().parse(patch.isFavorite);
  return next;
}

function mapSummary(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    color: parseLabelColor(row.color),
    isArchived: readSqliteFlag(row.isArchived ?? row.is_archived),
  };
}

function mapListItem(row: ProjectRow): ProjectListItem {
  return {
    ...mapSummary(row),
    isFavorite: readSqliteFlag(row.isFavorite ?? row.is_favorite),
    sortOrder: Number(row.sortOrder ?? row.sort_order ?? 0),
    createdAt: normalizeTimestamptz(row.createdAt ?? row.created_at ?? ''),
    updatedAt: normalizeTimestamptz(row.updatedAt ?? row.updated_at ?? ''),
    activeTaskCount: Number(row.activeTaskCount ?? 0),
    totalTaskCount: Number(row.totalTaskCount ?? 0),
  };
}

function normalizeTimestamptz(value: string): string {
  return value.replace(/^(\d{4}-\d{2}-\d{2}) (\d)/, '$1T$2');
}
