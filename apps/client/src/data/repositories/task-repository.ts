import type { CommonPowerSyncDatabase } from '@powersync/common';
import {
  type Task,
  type TaskInput,
  TaskNotFoundError,
  TaskRestoreConflictError,
  taskInputSchema,
} from './task';

export interface TaskRepository {
  create(input: TaskInput): Promise<void>;
  update(id: string, input: TaskInput): Promise<void>;
  /** Complete or reopen explicitly; does not toggle from UI state. */
  setCompletion(id: string, completed: boolean): Promise<void>;
  /** Reads a snapshot and deletes in one local write. */
  delete(id: string): Promise<Task>;
  /** Inserts the snapshot with its original id. Refuses if that id already exists locally. */
  restore(task: Task): Promise<void>;
  subscribe(onTasks: (tasks: Task[]) => void, onError: (error: Error) => void): () => void;
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
};

const TASK_COLUMNS = `id, title, description, priority, scheduled_date AS scheduledDate,
  scheduled_time AS scheduledTime, completed_at AS completedAt, created_at AS createdAt`;

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
    async create(input) {
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
      await database.execute(
        `INSERT INTO tasks
          (id, user_id, title, description, priority, scheduled_date, scheduled_time, completed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          target.userId,
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
    },

    async update(id, input) {
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
        if (assignments.length === 0) return;

        if (target.table === 'tasks') {
          assignments.push('updated_at = ?');
          params.push(new Date().toISOString());
          params.push(id, target.userId);
          await tx.execute(
            `UPDATE tasks SET ${assignments.join(', ')} WHERE id = ? AND user_id = ?`,
            params,
          );
          return;
        }
        params.push(id);
        await tx.execute(`UPDATE local_tasks SET ${assignments.join(', ')} WHERE id = ?`, params);
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
        await tx.execute(
          `INSERT INTO tasks
            (id, user_id, title, description, priority, scheduled_date, scheduled_time, completed_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            task.id,
            target.userId,
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
      });
    },

    subscribe(onTasks, onError) {
      const controller = new AbortController();
      const query =
        target.table === 'local_tasks'
          ? {
              sql: `SELECT ${TASK_COLUMNS}
         FROM local_tasks ORDER BY created_at DESC, id DESC`,
              parameters: [] as string[],
            }
          : {
              sql: `SELECT ${TASK_COLUMNS}
         FROM tasks WHERE user_id = ? ORDER BY created_at DESC, id DESC`,
              parameters: [target.userId],
            };
      database.watchWithCallback(
        query.sql,
        query.parameters,
        {
          onResult: (result) => {
            if (!controller.signal.aborted) onTasks((result.array as TaskRow[]).map(mapTaskRow));
          },
          onError: (error) => {
            if (!controller.signal.aborted) onError(error);
          },
        },
        { signal: controller.signal },
      );
      return () => controller.abort();
    },
  };
}

async function readOwnedTask(
  tx: { getOptional: CommonPowerSyncDatabase['getOptional'] },
  target: TaskTarget,
  id: string,
): Promise<Task | null> {
  if (target.table === 'local_tasks') {
    const row = await tx.getOptional<TaskRow>(
      `SELECT ${TASK_COLUMNS} FROM local_tasks WHERE id = ?`,
      [id],
    );
    return row ? mapTaskRow(row) : null;
  }
  const row = await tx.getOptional<TaskRow>(
    `SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ? AND user_id = ?`,
    [id, target.userId],
  );
  return row ? mapTaskRow(row) : null;
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

function mapTaskRow(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    priority: row.priority,
    scheduledDate: row.scheduledDate,
    scheduledTime: normalizeScheduledTime(row.scheduledTime),
    completedAt: row.completedAt == null ? null : normalizeTimestamptz(row.completedAt),
    createdAt: normalizeTimestamptz(row.createdAt),
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
