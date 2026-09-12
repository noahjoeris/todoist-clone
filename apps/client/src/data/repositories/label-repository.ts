import type { CommonPowerSyncDatabase } from '@powersync/common';
import { labelColorSchema } from '@todoist-clone/contracts';
import { z } from 'zod';
import {
  LabelDuplicateNameError,
  type LabelFields,
  type LabelInput,
  type LabelListItem,
  LabelNotFoundError,
  type LabelPatch,
  type LabelSummary,
  labelInputSchema,
  labelNameSchema,
  labelNamesEqual,
  parseLabelColor,
  readSqliteFavorite,
} from './label';

export interface LabelRepository {
  create(input: LabelInput): Promise<LabelSummary>;
  update(id: string, patch: LabelPatch): Promise<void>;
  /** Deletes association rows then the label in one local write. */
  delete(id: string): Promise<void>;
  findByName(name: string): Promise<LabelSummary | null>;
  /** Total tasks that use this label, including completed. */
  countAffectedTasks(id: string): Promise<number>;
  subscribe(
    onLabels: (labels: LabelListItem[]) => void,
    onError: (error: Error) => void,
  ): () => void;
}

export interface LabelRepositories {
  forUser(userId: string): LabelRepository;
}

type LabelDatabase = Pick<
  CommonPowerSyncDatabase,
  'getAll' | 'getOptional' | 'watchWithCallback' | 'writeTransaction'
>;

type LabelRow = {
  id: string;
  name: string;
  color: string;
  isFavorite?: unknown;
  is_favorite?: unknown;
  createdAt?: string;
  created_at?: string;
  activeTaskCount?: unknown;
};

const LABEL_WATCH_TABLES = ['labels', 'task_labels', 'tasks'];

export function createLabelRepositories(
  database: LabelDatabase,
  generateId: () => string,
): LabelRepositories {
  const byUser = new Map<string, LabelRepository>();
  return {
    forUser(userId) {
      const existing = byUser.get(userId);
      if (existing) return existing;
      const repository = createLabelRepository(database, generateId, userId);
      byUser.set(userId, repository);
      return repository;
    },
  };
}

export function createLabelRepository(
  database: LabelDatabase,
  generateId: () => string,
  userId: string,
): LabelRepository {
  return {
    async create(input) {
      const fields = labelInputSchema.parse(input);
      const id = generateId();
      const createdAt = new Date().toISOString();
      await database.writeTransaction(async (tx) => {
        await assertNameAvailable(tx, userId, fields.name);
        await tx.execute(
          `INSERT INTO labels
            (id, user_id, name, color, is_favorite, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            userId,
            fields.name,
            fields.color,
            favoriteToSqlite(fields.isFavorite),
            createdAt,
            createdAt,
          ],
        );
      });
      return { id, name: fields.name, color: fields.color };
    },

    async update(id, patch) {
      const parsed = parsePatch(patch);
      await database.writeTransaction(async (tx) => {
        const current = await readOwnedLabel(tx, userId, id);
        if (current === null) throw new LabelNotFoundError();

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
          params.push(favoriteToSqlite(parsed.isFavorite));
        }
        if (assignments.length === 0) return;

        assignments.push('updated_at = ?');
        params.push(new Date().toISOString(), id, userId);
        await tx.execute(
          `UPDATE labels SET ${assignments.join(', ')} WHERE id = ? AND user_id = ?`,
          params,
        );
      });
    },

    async delete(id) {
      await database.writeTransaction(async (tx) => {
        const current = await readOwnedLabel(tx, userId, id);
        if (current === null) throw new LabelNotFoundError();
        await tx.execute('DELETE FROM task_labels WHERE label_id = ? AND user_id = ?', [
          id,
          userId,
        ]);
        await tx.execute('DELETE FROM labels WHERE id = ? AND user_id = ?', [id, userId]);
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
        `SELECT COUNT(DISTINCT task_id) AS count FROM task_labels WHERE label_id = ? AND user_id = ?`,
        [id, userId],
      );
      return Number(row?.count ?? 0);
    },

    subscribe(onLabels, onError) {
      const sql = `SELECT
            l.id,
            l.name,
            l.color,
            l.is_favorite AS isFavorite,
            l.created_at AS createdAt,
            COUNT(DISTINCT CASE WHEN t.id IS NOT NULL AND t.completed_at IS NULL THEN t.id END)
              AS activeTaskCount
         FROM labels l
         LEFT JOIN task_labels tl ON tl.label_id = l.id AND tl.user_id = l.user_id
         LEFT JOIN tasks t ON t.id = tl.task_id AND t.user_id = l.user_id
         WHERE l.user_id = ?
         GROUP BY l.id, l.name, l.color, l.is_favorite, l.created_at
         ORDER BY lower(l.name) ASC, l.id ASC`;
      const controller = new AbortController();
      database.watchWithCallback(
        sql,
        [userId],
        {
          onResult: (result) => {
            if (controller.signal.aborted) return;
            onLabels((result.array as LabelRow[]).map(mapListItem));
          },
          onError: (error) => {
            if (!controller.signal.aborted) onError(error);
          },
        },
        { signal: controller.signal, tables: LABEL_WATCH_TABLES },
      );
      return () => controller.abort();
    },
  };
}

type LabelQuery = {
  getAll: CommonPowerSyncDatabase['getAll'];
};

type LabelTx = LabelQuery & {
  getOptional: CommonPowerSyncDatabase['getOptional'];
  execute: CommonPowerSyncDatabase['execute'];
};

async function assertNameAvailable(
  tx: LabelTx,
  userId: string,
  name: string,
  exceptId?: string,
): Promise<void> {
  const row = await findOwnedByName(tx, userId, name, exceptId);
  if (row) throw new LabelDuplicateNameError();
}

async function findOwnedByName(
  query: LabelQuery,
  userId: string,
  name: string,
  exceptId?: string,
): Promise<LabelRow | null> {
  const rows = await query.getAll<LabelRow>(
    exceptId === undefined
      ? `SELECT id, name, color FROM labels WHERE user_id = ?`
      : `SELECT id, name, color FROM labels WHERE user_id = ? AND id != ?`,
    exceptId === undefined ? [userId] : [userId, exceptId],
  );
  return rows.find((row) => labelNamesEqual(row.name, name)) ?? null;
}

async function readOwnedLabel(
  tx: LabelTx,
  userId: string,
  id: string,
): Promise<(LabelFields & { id: string }) | null> {
  const row = await tx.getOptional<LabelRow>(
    `SELECT id, name, color, is_favorite AS isFavorite FROM labels WHERE id = ? AND user_id = ?`,
    [id, userId],
  );
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    color: parseLabelColor(row.color),
    isFavorite: readSqliteFavorite(row.isFavorite),
  };
}

function parsePatch(patch: LabelPatch): LabelPatch {
  const next: LabelPatch = {};
  if (patch.name !== undefined) next.name = labelNameSchema.parse(patch.name);
  if (patch.color !== undefined) next.color = labelColorSchema.parse(patch.color);
  if (patch.isFavorite !== undefined) next.isFavorite = z.boolean().parse(patch.isFavorite);
  return next;
}

function mapSummary(row: LabelRow): LabelSummary {
  return { id: row.id, name: row.name, color: parseLabelColor(row.color) };
}

function mapListItem(row: LabelRow): LabelListItem {
  return {
    ...mapSummary(row),
    isFavorite: readSqliteFavorite(row.isFavorite ?? row.is_favorite),
    createdAt: normalizeTimestamptz(row.createdAt ?? row.created_at ?? ''),
    activeTaskCount: Number(row.activeTaskCount ?? 0),
  };
}

function favoriteToSqlite(value: boolean): number {
  return value ? 1 : 0;
}

function normalizeTimestamptz(value: string): string {
  return value.replace(/^(\d{4}-\d{2}-\d{2}) (\d)/, '$1T$2');
}
