import type { CommonPowerSyncDatabase } from '@powersync/common';
import { type Task, type TaskInput, taskInputSchema } from './task';

export interface TaskRepository {
  create(input: TaskInput): Promise<void>;
  subscribe(onTasks: (tasks: Task[]) => void, onError: (error: Error) => void): () => void;
}

export interface TaskRepositories {
  guest: TaskRepository;
  forUser(userId: string): TaskRepository;
}

type TaskDatabase = Pick<CommonPowerSyncDatabase, 'execute' | 'watchWithCallback'>;

type TaskTarget = { table: 'local_tasks' } | { table: 'tasks'; userId: string };

type TaskRow = {
  id: string;
  title: string;
  description: string;
  priority: Task['priority'];
  scheduledDate: string | null;
  scheduledTime: string | null;
  createdAt: string;
};

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
          (id, title, description, priority, scheduled_date, scheduled_time, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            task.title,
            task.description,
            task.priority,
            task.scheduledDate,
            task.scheduledTime,
            createdAt,
          ],
        );
        return;
      }
      await database.execute(
        `INSERT INTO tasks
          (id, user_id, title, description, priority, scheduled_date, scheduled_time, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          target.userId,
          task.title,
          task.description,
          task.priority,
          task.scheduledDate,
          task.scheduledTime,
          createdAt,
          createdAt,
        ],
      );
    },
    subscribe(onTasks, onError) {
      const controller = new AbortController();
      const query =
        target.table === 'local_tasks'
          ? {
              sql: `SELECT id, title, description, priority, scheduled_date AS scheduledDate,
                scheduled_time AS scheduledTime, created_at AS createdAt
         FROM local_tasks ORDER BY created_at DESC, id DESC`,
              parameters: [] as string[],
            }
          : {
              sql: `SELECT id, title, description, priority, scheduled_date AS scheduledDate,
                scheduled_time AS scheduledTime, created_at AS createdAt
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

function mapTaskRow(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    priority: row.priority,
    scheduledDate: row.scheduledDate,
    scheduledTime: normalizeScheduledTime(row.scheduledTime),
    createdAt: row.createdAt,
  };
}

/** Server `time(0)` echoes `HH:mm:ss`; the app stores and displays `HH:mm`. */
function normalizeScheduledTime(value: string | null): string | null {
  if (value == null) return null;
  return value.slice(0, 5);
}
