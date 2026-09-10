import type { CommonPowerSyncDatabase } from '@powersync/common';
import { type Task, type TaskInput, taskInputSchema } from './task';

export interface TaskRepository {
  create(input: TaskInput): Promise<void>;
  subscribe(onTasks: (tasks: Task[]) => void, onError: (error: Error) => void): () => void;
}

type TaskDatabase = Pick<CommonPowerSyncDatabase, 'execute' | 'watchWithCallback'>;

export function createTaskRepository(
  database: TaskDatabase,
  generateId: () => string,
): TaskRepository {
  return {
    async create(input) {
      const task = taskInputSchema.parse(input);
      await database.execute(
        `INSERT INTO local_tasks
          (id, title, description, priority, scheduled_date, scheduled_time, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          generateId(),
          task.title,
          task.description,
          task.priority,
          task.scheduledDate,
          task.scheduledTime,
          new Date().toISOString(),
        ],
      );
    },
    subscribe(onTasks, onError) {
      const controller = new AbortController();
      database.watchWithCallback(
        `SELECT id, title, description, priority, scheduled_date AS scheduledDate,
                scheduled_time AS scheduledTime, created_at AS createdAt
         FROM local_tasks ORDER BY created_at DESC, id DESC`,
        [],
        {
          onResult: (result) => {
            if (!controller.signal.aborted) onTasks(result.array as Task[]);
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
