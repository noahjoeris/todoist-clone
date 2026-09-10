import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type {
  CommonPowerSyncDatabase,
  QueryResult,
  SQLWatchOptions,
  WatchHandler,
} from '@powersync/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTaskRepository } from './task-repository';

// Exercise the repository's real SQL against SQLite. PowerSync's watch delivery is
// simulated separately; browser smoke checks cover the actual PowerSync adapter.
describe('task repository', () => {
  let sqlite: DatabaseSync;
  let directory: string;
  let filename: string;
  const execute =
    vi.fn<(sql: string, parameters?: SQLInputValue[]) => Promise<QueryResult<never>>>();
  const watch = vi.fn<CommonPowerSyncDatabase['watchWithCallback']>();
  const repository = createTaskRepository({ execute, watchWithCallback: watch }, randomUUID);

  beforeEach(() => {
    vi.resetAllMocks();
    directory = mkdtempSync(join(tmpdir(), 'todoist-tasks-'));
    filename = join(directory, 'tasks.sqlite');
    sqlite = new DatabaseSync(filename);
    sqlite.exec(`CREATE TABLE local_tasks (
      id TEXT PRIMARY KEY, title TEXT, description TEXT, priority INTEGER,
      scheduled_date TEXT, scheduled_time TEXT, created_at TEXT
    )`);
    execute.mockImplementation(async (sql, parameters = []) => {
      sqlite.prepare(sql).run(...(parameters as SQLInputValue[]));
      return {
        array: [],
        [Symbol.iterator]: () => [][Symbol.iterator](),
      };
    });
  });

  afterEach(() => {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
    vi.useRealTimers();
  });

  it('persists fields, UUIDs, and date-only tasks after reopening SQLite', async () => {
    await repository.create({
      title: "  Don't forget  ",
      description: ' First\nSecond ',
      priority: 1,
      scheduledDate: '2026-09-09',
      scheduledTime: '00:00',
    });
    await repository.create({ title: 'Date only', scheduledDate: '2026-09-10' });
    sqlite.close();
    sqlite = new DatabaseSync(filename);
    const rows = sqlite.prepare('SELECT * FROM local_tasks ORDER BY title').all();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      title: 'Date only',
      priority: 4,
      scheduled_date: '2026-09-10',
      scheduled_time: null,
    });
    expect(rows[1]).toMatchObject({
      title: "Don't forget",
      description: 'First\nSecond',
      priority: 1,
      scheduled_date: '2026-09-09',
      scheduled_time: '00:00',
    });
    expect(rows[0]?.id).not.toBe(rows[1]?.id);
    expect(rows[0]?.id).toMatch(/^[\da-f-]{36}$/);
  });

  it('rejects invalid tasks before writing and propagates write failures', async () => {
    await expect(repository.create({ title: '  ' })).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
    execute.mockRejectedValueOnce(new Error('Disk full'));
    await expect(repository.create({ title: 'Keep my draft' })).rejects.toThrow('Disk full');
  });

  it('reads newest first, forwards read errors, and stops callbacks after unsubscribe', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-09T10:00:00Z'));
    await repository.create({ title: 'Earlier' });
    vi.setSystemTime(new Date('2026-09-09T11:00:00Z'));
    await repository.create({ title: 'Later', priority: 2, scheduledDate: '2026-09-10' });
    let handler: WatchHandler | undefined;
    let options: SQLWatchOptions | undefined;
    let result: QueryResult | undefined;
    watch.mockImplementation((sql, parameters, callback, watchOptions) => {
      handler = callback;
      options = watchOptions;
      const array = sqlite.prepare(sql).all(...(parameters ?? []));
      result = {
        array,
        *[Symbol.iterator]() {
          yield* array;
          return undefined;
        },
      };
      callback?.onResult(result);
    });
    const onTasks = vi.fn();
    const onError = vi.fn();
    const unsubscribe = repository.subscribe(onTasks, onError);
    expect(onTasks.mock.calls[0]?.[0]).toMatchObject([
      { title: 'Later', priority: 2, scheduledDate: '2026-09-10', scheduledTime: null },
      { title: 'Earlier', scheduledDate: null },
    ]);
    handler?.onError?.(new Error('Read failed'));
    expect(onError).toHaveBeenCalledOnce();
    unsubscribe();
    expect(options?.signal?.aborted).toBe(true);
    if (result) handler?.onResult(result);
    handler?.onError?.(new Error('After unsubscribe'));
    expect(onTasks).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledOnce();
  });
});
