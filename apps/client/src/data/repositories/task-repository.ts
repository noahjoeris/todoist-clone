import type { CommonPowerSyncDatabase } from '@powersync/common';
import { type LabelSummary, parseLabelColor, sortLabelsByName } from './label';
import { diffLabelAssociations, uniqueIds } from './label-associations';
import { ProjectNotFoundError, type ProjectSummary, readSqliteFlag } from './project';
import {
  type Task,
  type TaskInput,
  type TaskLabelEdit,
  TaskNotFoundError,
  type TaskProjectEdit,
  TaskRestoreConflictError,
  taskInputSchema,
} from './task';
import {
  type TaskActiveCounts,
  type TaskViewQuery,
  viewOrderSql,
  viewPredicate,
} from './task-view';

export interface TaskRepository {
  create(input: TaskInput, labelIds?: readonly string[], projectId?: string | null): Promise<void>;
  update(
    id: string,
    input: TaskInput,
    labels?: TaskLabelEdit,
    project?: TaskProjectEdit,
  ): Promise<void>;
  /** Complete or reopen explicitly; does not toggle from UI state. */
  setCompletion(id: string, completed: boolean): Promise<void>;
  /** Reads a snapshot and deletes in one local write. */
  delete(id: string): Promise<Task>;
  /** Inserts the snapshot with its original id. Refuses if that id already exists locally. */
  restore(task: Task): Promise<void>;
  subscribe(onTasks: (tasks: Task[]) => void, onError: (error: Error) => void): () => void;
  subscribeById(
    id: string,
    onTask: (task: Task | null) => void,
    onError: (error: Error) => void,
  ): () => void;
  subscribeView(
    query: TaskViewQuery,
    onTasks: (tasks: Task[]) => void,
    onError: (error: Error) => void,
  ): () => void;
  subscribeActiveCounts(
    today: string,
    onCounts: (counts: TaskActiveCounts) => void,
    onError: (error: Error) => void,
  ): () => void;
}

export interface TaskRepositories {
  guest: TaskRepository;
  forUser(userId: string): TaskRepository;
}

type TaskDatabase = Pick<
  CommonPowerSyncDatabase,
  'execute' | 'watchWithCallback' | 'writeTransaction'
>;

type TaskTarget = { table: 'local_tasks' } | { table: 'tasks'; userId: string };

type TaskRow = {
  id: string;
  title: string;
  description: string;
  priority: Task['priority'];
  scheduledDate: string | null;
  scheduledTime: string | null;
  completedAt: string | null;
  createdAt: string;
  labelId?: string | null;
  labelName?: string | null;
  labelColor?: string | null;
  projectId?: string | null;
  projectSummaryId?: string | null;
  projectName?: string | null;
  projectColor?: string | null;
  projectIsArchived?: unknown;
};

type TaskTx = {
  getOptional: CommonPowerSyncDatabase['getOptional'];
  getAll: CommonPowerSyncDatabase['getAll'];
  execute: CommonPowerSyncDatabase['execute'];
};

const TASK_COLUMNS = `id, title, description, priority, scheduled_date AS scheduledDate,
  scheduled_time AS scheduledTime, completed_at AS completedAt, created_at AS createdAt`;

const TASK_TABLE_COLUMNS = `t.id, t.title, t.description, t.priority, t.scheduled_date AS scheduledDate,
  t.scheduled_time AS scheduledTime, t.completed_at AS completedAt, t.created_at AS createdAt,
  t.project_id AS projectId,
  p.id AS projectSummaryId, p.name AS projectName, p.color AS projectColor,
  p.is_archived AS projectIsArchived,
  l.id AS labelId, l.name AS labelName, l.color AS labelColor`;

const ACCOUNT_WATCH_TABLES = ['tasks', 'labels', 'task_labels', 'projects'];

const TASK_ACCOUNT_JOINS = `FROM tasks t
         LEFT JOIN projects p ON p.id = t.project_id AND p.user_id = t.user_id
         LEFT JOIN task_labels tl ON tl.task_id = t.id AND tl.user_id = t.user_id
         LEFT JOIN labels l ON l.id = tl.label_id AND l.user_id = t.user_id`;

export function createTaskRepositories(
  database: TaskDatabase,
  generateId: () => string,
): TaskRepositories {
  const byUser = new Map<string, TaskRepository>();
  return {
    guest: createTableTaskRepository(database, generateId, { table: 'local_tasks' }),
    forUser(userId) {
      const existing = byUser.get(userId);
      if (existing) return existing;
      const repository = createTableTaskRepository(database, generateId, {
        table: 'tasks',
        userId,
      });
      byUser.set(userId, repository);
      return repository;
    },
  };
}

export function createTaskRepository(
  database: TaskDatabase,
  generateId: () => string,
): TaskRepository {
  return createTableTaskRepository(database, generateId, { table: 'local_tasks' });
}

function createTableTaskRepository(
  database: TaskDatabase,
  generateId: () => string,
  target: TaskTarget,
): TaskRepository {
  return {
    async create(input, labelIds, projectId) {
      const task = taskInputSchema.parse(input);
      const id = generateId();
      const createdAt = new Date().toISOString();
      if (target.table === 'local_tasks') {
        await database.execute(
          `INSERT INTO local_tasks
          (id, title, description, priority, scheduled_date, scheduled_time, completed_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            task.title,
            task.description,
            task.priority,
            task.scheduledDate,
            task.scheduledTime,
            null,
            createdAt,
          ],
        );
        return;
      }

      const selected = uniqueIds(labelIds ?? []);
      const membership = projectId ?? null;
      await database.writeTransaction(async (tx) => {
        if (membership != null) {
          await assertOwnedProject(tx, target.userId, membership);
        }
        await tx.execute(
          `INSERT INTO tasks
            (id, user_id, project_id, title, description, priority, scheduled_date, scheduled_time,
             completed_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            target.userId,
            membership,
            task.title,
            task.description,
            task.priority,
            task.scheduledDate,
            task.scheduledTime,
            null,
            createdAt,
            createdAt,
          ],
        );
        await attachLabels(tx, generateId, target.userId, id, selected, createdAt);
      });
    },

    async update(id, input, labels, project) {
      const task = taskInputSchema.parse(input);
      await database.writeTransaction(async (tx) => {
        const current = await readOwnedTask(tx, target, id);
        if (current === null) throw new TaskNotFoundError();

        const assignments: string[] = [];
        const params: unknown[] = [];
        if (current.title !== task.title) {
          assignments.push('title = ?');
          params.push(task.title);
        }
        if (current.description !== task.description) {
          assignments.push('description = ?');
          params.push(task.description);
        }
        if (current.priority !== task.priority) {
          assignments.push('priority = ?');
          params.push(task.priority);
        }
        if (current.scheduledDate !== task.scheduledDate) {
          assignments.push('scheduled_date = ?');
          params.push(task.scheduledDate);
        }
        if (current.scheduledTime !== task.scheduledTime) {
          assignments.push('scheduled_time = ?');
          params.push(task.scheduledTime);
        }
        if (project && target.table === 'tasks' && current.projectId !== project.projectId) {
          if (project.projectId != null) {
            await assertOwnedProject(tx, target.userId, project.projectId);
          }
          assignments.push('project_id = ?');
          params.push(project.projectId);
        }

        if (assignments.length > 0) {
          if (target.table === 'tasks') {
            assignments.push('updated_at = ?');
            params.push(new Date().toISOString());
            params.push(id, target.userId);
            await tx.execute(
              `UPDATE tasks SET ${assignments.join(', ')} WHERE id = ? AND user_id = ?`,
              params,
            );
          } else {
            params.push(id);
            await tx.execute(
              `UPDATE local_tasks SET ${assignments.join(', ')} WHERE id = ?`,
              params,
            );
          }
        }

        if (labels && target.table === 'tasks') {
          await syncTaskLabels(tx, generateId, target.userId, id, labels);
        }
      });
    },

    async setCompletion(id, completed) {
      await database.writeTransaction(async (tx) => {
        const current = await readOwnedTask(tx, target, id);
        if (current === null) throw new TaskNotFoundError();

        if (completed) {
          if (current.completedAt != null) return;
          const completedAt = new Date().toISOString();
          await writeCompletion(tx, target, id, completedAt);
          return;
        }
        if (current.completedAt == null) return;
        await writeCompletion(tx, target, id, null);
      });
    },

    async delete(id) {
      return database.writeTransaction(async (tx) => {
        const current = await readOwnedTask(tx, target, id);
        if (current === null) throw new TaskNotFoundError();
        if (target.table === 'tasks') {
          await tx.execute('DELETE FROM task_labels WHERE task_id = ? AND user_id = ?', [
            id,
            target.userId,
          ]);
          await tx.execute('DELETE FROM tasks WHERE id = ? AND user_id = ?', [id, target.userId]);
        } else {
          await tx.execute('DELETE FROM local_tasks WHERE id = ?', [id]);
        }
        return current;
      });
    },

    async restore(task) {
      await database.writeTransaction(async (tx) => {
        const existing = await tx.getOptional<{ id: string }>(
          `SELECT id FROM ${target.table} WHERE id = ?`,
          [task.id],
        );
        if (existing) throw new TaskRestoreConflictError();

        if (target.table === 'local_tasks') {
          await tx.execute(
            `INSERT INTO local_tasks
              (id, title, description, priority, scheduled_date, scheduled_time, completed_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              task.id,
              task.title,
              task.description,
              task.priority,
              task.scheduledDate,
              task.scheduledTime,
              task.completedAt,
              task.createdAt,
            ],
          );
          return;
        }
        const now = new Date().toISOString();
        const membership = await restoreProjectId(tx, target.userId, task.projectId);
        await tx.execute(
          `INSERT INTO tasks
            (id, user_id, project_id, title, description, priority, scheduled_date, scheduled_time,
             completed_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            task.id,
            target.userId,
            membership,
            task.title,
            task.description,
            task.priority,
            task.scheduledDate,
            task.scheduledTime,
            task.completedAt,
            task.createdAt,
            now,
          ],
        );
        await attachLabels(
          tx,
          generateId,
          target.userId,
          task.id,
          task.labels.map((label) => label.id),
          now,
        );
      });
    },

    subscribe(onTasks, onError) {
      if (target.table === 'local_tasks') {
        return watchQuery<TaskRow>(
          database,
          `SELECT ${TASK_COLUMNS}
         FROM local_tasks ORDER BY created_at DESC, id DESC`,
          [],
          (rows) => {
            onTasks(rows.map(mapGuestTaskRow));
          },
          onError,
        );
      }
      return watchQuery<TaskRow>(
        database,
        `SELECT ${TASK_TABLE_COLUMNS}
         ${TASK_ACCOUNT_JOINS}
         WHERE t.user_id = ?
         ORDER BY t.created_at DESC, t.id DESC, lower(l.name) ASC, l.id ASC`,
        [target.userId],
        (rows) => {
          onTasks(collectAccountTasks(rows));
        },
        onError,
        ACCOUNT_WATCH_TABLES,
      );
    },

    subscribeById(id, onTask, onError) {
      if (target.table === 'local_tasks') {
        return watchQuery<TaskRow>(
          database,
          `SELECT ${TASK_COLUMNS} FROM local_tasks WHERE id = ?`,
          [id],
          (rows) => {
            onTask(rows[0] ? mapGuestTaskRow(rows[0]) : null);
          },
          onError,
        );
      }
      return watchQuery<TaskRow>(
        database,
        `SELECT ${TASK_TABLE_COLUMNS}
         ${TASK_ACCOUNT_JOINS}
         WHERE t.id = ? AND t.user_id = ?
         ORDER BY lower(l.name) ASC, l.id ASC`,
        [id, target.userId],
        (rows) => {
          onTask(collectAccountTasks(rows)[0] ?? null);
        },
        onError,
        ACCOUNT_WATCH_TABLES,
      );
    },

    subscribeView(query, onTasks, onError) {
      const compiled = compileViewQuery(target, query);
      return watchQuery<TaskRow>(
        database,
        compiled.sql,
        compiled.parameters,
        (rows) => {
          onTasks(
            target.table === 'local_tasks' ? rows.map(mapGuestTaskRow) : collectAccountTasks(rows),
          );
        },
        onError,
        target.table === 'tasks' ? ACCOUNT_WATCH_TABLES : undefined,
      );
    },

    subscribeActiveCounts(today, onCounts, onError) {
      const compiled = compileActiveCountQuery(target, today);
      return watchQuery<{ inbox?: unknown; today?: unknown }>(
        database,
        compiled.sql,
        compiled.parameters,
        (rows) => {
          const row = rows[0];
          onCounts({
            inbox: Number(row?.inbox ?? 0),
            today: Number(row?.today ?? 0),
          });
        },
        onError,
      );
    },
  };
}

type OwnerScope = { from: string; sql: string; params: string[] };

function ownerScope(target: TaskTarget): OwnerScope {
  if (target.table === 'local_tasks') {
    return { from: 'local_tasks', sql: '1 = 1', params: [] };
  }
  return { from: 'tasks', sql: 'user_id = ?', params: [target.userId] };
}

function compileViewQuery(
  target: TaskTarget,
  query: TaskViewQuery,
): { sql: string; parameters: string[] } {
  const view = viewPredicate(query);

  if (target.table === 'local_tasks') {
    if (query.destination === 'label' || query.destination === 'project') {
      return {
        sql: `SELECT ${TASK_COLUMNS} FROM local_tasks WHERE 0`,
        parameters: [],
      };
    }
    const owner = ownerScope(target);
    return {
      sql: `SELECT ${TASK_COLUMNS}
         FROM ${owner.from}
         WHERE ${owner.sql} AND ${view.sql}
         ${viewOrderSql(query)}`,
      parameters: [...owner.params, ...view.params],
    };
  }

  const userId = target.userId;
  const viewSql = qualifyTaskColumns(view.sql);
  if (query.destination === 'label') {
    return {
      sql: `SELECT ${TASK_TABLE_COLUMNS}
         FROM tasks t
         INNER JOIN task_labels membership
           ON membership.task_id = t.id AND membership.label_id = ? AND membership.user_id = t.user_id
         LEFT JOIN projects p ON p.id = t.project_id AND p.user_id = t.user_id
         LEFT JOIN task_labels tl ON tl.task_id = t.id AND tl.user_id = t.user_id
         LEFT JOIN labels l ON l.id = tl.label_id AND l.user_id = t.user_id
         WHERE t.user_id = ? AND ${viewSql}
         ${qualifyOrderSql(viewOrderSql(query))}, lower(l.name) ASC, l.id ASC`,
      parameters: [query.labelId, userId, ...view.params],
    };
  }

  if (query.destination === 'project') {
    return {
      sql: `SELECT ${TASK_TABLE_COLUMNS}
         ${TASK_ACCOUNT_JOINS}
         WHERE t.user_id = ? AND t.project_id = ? AND ${viewSql}
         ${qualifyOrderSql(viewOrderSql(query))}, lower(l.name) ASC, l.id ASC`,
      parameters: [userId, query.projectId, ...view.params],
    };
  }

  const inboxMembership = query.destination === 'inbox' ? ' AND t.project_id IS NULL' : '';
  return {
    sql: `SELECT ${TASK_TABLE_COLUMNS}
         ${TASK_ACCOUNT_JOINS}
         WHERE t.user_id = ? AND ${viewSql}${inboxMembership}
         ${qualifyOrderSql(viewOrderSql(query))}, lower(l.name) ASC, l.id ASC`,
    parameters: [userId, ...view.params],
  };
}

function qualifyTaskColumns(sql: string): string {
  return sql
    .replaceAll('completed_at', 't.completed_at')
    .replaceAll('scheduled_date', 't.scheduled_date')
    .replaceAll('project_id', 't.project_id');
}

function qualifyOrderSql(order: string): string {
  return order
    .replaceAll('completed_at', 't.completed_at')
    .replaceAll('scheduled_date', 't.scheduled_date')
    .replaceAll('scheduled_time', 't.scheduled_time')
    .replaceAll('priority', 't.priority')
    .replaceAll('created_at', 't.created_at')
    .replaceAll(', id ', ', t.id ')
    .replaceAll(' id DESC', ' t.id DESC');
}

function compileActiveCountQuery(
  target: TaskTarget,
  today: string,
): { sql: string; parameters: string[] } {
  const owner = ownerScope(target);
  const inboxPredicate =
    target.table === 'tasks'
      ? 'completed_at IS NULL AND project_id IS NULL'
      : 'completed_at IS NULL';
  return {
    sql: `SELECT
            COALESCE(SUM(CASE WHEN ${inboxPredicate} THEN 1 ELSE 0 END), 0) AS inbox,
            COALESCE(SUM(CASE WHEN completed_at IS NULL AND scheduled_date IS NOT NULL AND scheduled_date <= ? THEN 1 ELSE 0 END), 0) AS today
         FROM ${owner.from}
         WHERE ${owner.sql}`,
    parameters: [today, ...owner.params],
  };
}

function watchQuery<T>(
  database: TaskDatabase,
  sql: string,
  parameters: string[],
  onRows: (rows: T[]) => void,
  onError: (error: Error) => void,
  triggerOnTables?: string[],
): () => void {
  const controller = new AbortController();
  database.watchWithCallback(
    sql,
    parameters,
    {
      onResult: (result) => {
        if (!controller.signal.aborted) onRows(result.array as T[]);
      },
      onError: (error) => {
        if (!controller.signal.aborted) onError(error);
      },
    },
    triggerOnTables
      ? { signal: controller.signal, tables: triggerOnTables }
      : { signal: controller.signal },
  );
  return () => controller.abort();
}

async function readOwnedTask(tx: TaskTx, target: TaskTarget, id: string): Promise<Task | null> {
  if (target.table === 'local_tasks') {
    const row = await tx.getOptional<TaskRow>(
      `SELECT ${TASK_COLUMNS} FROM local_tasks WHERE id = ?`,
      [id],
    );
    return row ? mapGuestTaskRow(row) : null;
  }
  const rows = await tx.getAll<TaskRow>(
    `SELECT ${TASK_TABLE_COLUMNS}
     ${TASK_ACCOUNT_JOINS}
     WHERE t.id = ? AND t.user_id = ?
     ORDER BY lower(l.name) ASC, l.id ASC`,
    [id, target.userId],
  );
  if (rows.length === 0) return null;
  return collectAccountTasks(rows)[0] ?? null;
}

async function writeCompletion(
  tx: { execute: CommonPowerSyncDatabase['execute'] },
  target: TaskTarget,
  id: string,
  completedAt: string | null,
): Promise<void> {
  if (target.table === 'local_tasks') {
    await tx.execute('UPDATE local_tasks SET completed_at = ? WHERE id = ?', [completedAt, id]);
    return;
  }
  await tx.execute(
    'UPDATE tasks SET completed_at = ?, updated_at = ? WHERE id = ? AND user_id = ?',
    [completedAt, new Date().toISOString(), id, target.userId],
  );
}

async function syncTaskLabels(
  tx: TaskTx,
  generateId: () => string,
  userId: string,
  taskId: string,
  edit: TaskLabelEdit,
): Promise<void> {
  const currentRows = await tx.getAll<{ label_id: string }>(
    'SELECT label_id FROM task_labels WHERE task_id = ? AND user_id = ?',
    [taskId, userId],
  );
  const current = currentRows.map((row) => row.label_id);
  const { attach, detach } = diffLabelAssociations(
    edit.baselineLabelIds,
    current,
    uniqueIds(edit.labelIds),
  );
  for (const labelId of detach) {
    await tx.execute('DELETE FROM task_labels WHERE task_id = ? AND label_id = ? AND user_id = ?', [
      taskId,
      labelId,
      userId,
    ]);
  }
  await attachLabels(tx, generateId, userId, taskId, attach, new Date().toISOString());
}

async function attachLabels(
  tx: TaskTx,
  generateId: () => string,
  userId: string,
  taskId: string,
  labelIds: readonly string[],
  createdAt: string,
): Promise<void> {
  for (const labelId of uniqueIds(labelIds)) {
    const label = await tx.getOptional<{ id: string }>(
      'SELECT id FROM labels WHERE id = ? AND user_id = ?',
      [labelId, userId],
    );
    if (!label) continue;
    const existing = await tx.getOptional<{ id: string }>(
      'SELECT id FROM task_labels WHERE task_id = ? AND label_id = ? AND user_id = ?',
      [taskId, labelId, userId],
    );
    if (existing) continue;
    await tx.execute(
      `INSERT INTO task_labels (id, user_id, task_id, label_id, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [generateId(), userId, taskId, labelId, createdAt],
    );
  }
}

function collectAccountTasks(rows: TaskRow[]): Task[] {
  const tasks: Task[] = [];
  const byId = new Map<string, Task>();
  for (const row of rows) {
    let task = byId.get(row.id);
    if (!task) {
      task = mapTaskFields(row);
      byId.set(row.id, task);
      tasks.push(task);
    }
    const summary = labelSummaryFromRow(row);
    if (summary && !task.labels.some((label) => label.id === summary.id)) {
      task.labels.push(summary);
    }
  }
  for (const task of tasks) {
    task.labels = sortLabelsByName(task.labels);
  }
  return tasks;
}

function mapGuestTaskRow(row: TaskRow): Task {
  return { ...mapTaskFields(row), labels: [], projectId: null, project: null };
}

function mapTaskFields(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    priority: row.priority,
    scheduledDate: row.scheduledDate,
    scheduledTime: normalizeScheduledTime(row.scheduledTime),
    completedAt: row.completedAt == null ? null : normalizeTimestamptz(row.completedAt),
    createdAt: normalizeTimestamptz(row.createdAt),
    labels: [],
    projectId: row.projectId ?? null,
    project: projectSummaryFromRow(row),
  };
}

function projectSummaryFromRow(row: TaskRow): ProjectSummary | null {
  if (row.projectSummaryId == null || row.projectName == null || row.projectColor == null) {
    return null;
  }
  return {
    id: row.projectSummaryId,
    name: row.projectName,
    color: parseLabelColor(row.projectColor),
    isArchived: readSqliteFlag(row.projectIsArchived),
  };
}

async function assertOwnedProject(tx: TaskTx, userId: string, projectId: string): Promise<void> {
  const row = await tx.getOptional<{ id: string }>(
    'SELECT id FROM projects WHERE id = ? AND user_id = ?',
    [projectId, userId],
  );
  if (!row) throw new ProjectNotFoundError();
}

async function restoreProjectId(
  tx: TaskTx,
  userId: string,
  projectId: string | null,
): Promise<string | null> {
  if (projectId == null) return null;
  const row = await tx.getOptional<{ id: string }>(
    'SELECT id FROM projects WHERE id = ? AND user_id = ?',
    [projectId, userId],
  );
  return row ? projectId : null;
}

function labelSummaryFromRow(row: TaskRow): LabelSummary | null {
  if (row.labelId == null || row.labelName == null || row.labelColor == null) return null;
  return {
    id: row.labelId,
    name: row.labelName,
    color: parseLabelColor(row.labelColor),
  };
}

/** Server `time(0)` echoes `HH:mm:ss`; the app stores and displays `HH:mm`. */
function normalizeScheduledTime(value: string | null): string | null {
  if (value == null) return null;
  return value.slice(0, 5);
}

/**
 * PowerSync maps Postgres timestamptz to SQLite text as `YYYY-MM-DD hh:mm:ss.sssZ`
 * (space separator). Restore PUT needs RFC 3339 with `T`.
 */
function normalizeTimestamptz(value: string): string {
  return value.replace(/^(\d{4}-\d{2}-\d{2}) (\d)/, '$1T$2');
}
