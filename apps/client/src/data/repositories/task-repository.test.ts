import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type {
  CommonPowerSyncDatabase,
  QueryResult,
  SQLWatchOptions,
  Transaction,
  WatchHandler,
} from '@powersync/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskNotFoundError, TaskRestoreConflictError } from './task';
import { createTaskRepositories, createTaskRepository } from './task-repository';

const MISSING_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function emptyResult(): QueryResult<never> {
  return {
    array: [],
    [Symbol.iterator]: () => [][Symbol.iterator](),
  };
}

function bindSqlite(
  sqlite: DatabaseSync,
  execute: ReturnType<typeof vi.fn>,
  writeTransaction: ReturnType<typeof vi.fn>,
) {
  execute.mockImplementation(async (sql: string, parameters: SQLInputValue[] = []) => {
    sqlite.prepare(sql).run(...parameters);
    return emptyResult();
  });
  writeTransaction.mockImplementation(async (callback: (tx: Transaction) => Promise<unknown>) => {
    sqlite.exec('BEGIN');
    try {
      const result = await callback({
        getOptional: async (sql: string, parameters: SQLInputValue[] = []) =>
          sqlite.prepare(sql).get(...parameters) ?? null,
        execute: async (sql: string, parameters: SQLInputValue[] = []) => {
          sqlite.prepare(sql).run(...parameters);
          return emptyResult();
        },
      } as unknown as Transaction);
      sqlite.exec('COMMIT');
      return result;
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
  });
}

function loadId(sqlite: DatabaseSync, table: 'local_tasks' | 'tasks'): string {
  const row = sqlite.prepare(`SELECT id FROM ${table}`).get() as { id: string } | undefined;
  if (!row) throw new Error('expected a row');
  return row.id;
}

// Exercise the repository's real SQL against SQLite. PowerSync's watch delivery is
// simulated separately; browser smoke checks cover the actual PowerSync adapter.
describe('task repository', () => {
  let sqlite: DatabaseSync;
  let directory: string;
  let filename: string;
  const execute =
    vi.fn<(sql: string, parameters?: SQLInputValue[]) => Promise<QueryResult<never>>>();
  const watch = vi.fn<CommonPowerSyncDatabase['watchWithCallback']>();
  const writeTransaction = vi.fn();
  const repository = createTaskRepository(
    { execute, watchWithCallback: watch, writeTransaction },
    randomUUID,
  );

  beforeEach(() => {
    vi.resetAllMocks();
    directory = mkdtempSync(join(tmpdir(), 'todoist-tasks-'));
    filename = join(directory, 'tasks.sqlite');
    sqlite = new DatabaseSync(filename);
    sqlite.exec(`CREATE TABLE local_tasks (
      id TEXT PRIMARY KEY, title TEXT, description TEXT, priority INTEGER,
      scheduled_date TEXT, scheduled_time TEXT, completed_at TEXT, created_at TEXT
    )`);
    bindSqlite(sqlite, execute, writeTransaction);
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
      completed_at: null,
    });
    expect(rows[1]).toMatchObject({
      title: "Don't forget",
      description: 'First\nSecond',
      priority: 1,
      scheduled_date: '2026-09-09',
      scheduled_time: '00:00',
      completed_at: null,
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
      {
        title: 'Later',
        priority: 2,
        scheduledDate: '2026-09-10',
        scheduledTime: null,
        completedAt: null,
      },
      { title: 'Earlier', scheduledDate: null, completedAt: null },
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

  it('completes idempotently, reopens, and records a new timestamp on the next complete', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-11T12:00:00Z'));
    await repository.create({
      title: 'Ship it',
      scheduledDate: '2026-09-12',
      scheduledTime: '09:30',
      priority: 1,
    });
    const id = loadId(sqlite, 'local_tasks');

    await repository.setCompletion(id, true);
    const first = sqlite.prepare('SELECT * FROM local_tasks').get() as {
      completed_at: string;
      scheduled_date: string;
      scheduled_time: string;
      priority: number;
    };
    expect(first.completed_at).toBe('2026-09-11T12:00:00.000Z');

    vi.setSystemTime(new Date('2026-09-11T12:00:05Z'));
    await repository.setCompletion(id, true);
    expect(sqlite.prepare('SELECT completed_at FROM local_tasks').get()).toEqual({
      completed_at: '2026-09-11T12:00:00.000Z',
    });

    await repository.setCompletion(id, false);
    const reopened = sqlite.prepare('SELECT * FROM local_tasks').get() as {
      completed_at: string | null;
      scheduled_date: string;
      scheduled_time: string;
      title: string;
    };
    expect(reopened.completed_at).toBeNull();
    expect(reopened.scheduled_date).toBe('2026-09-12');
    expect(reopened.scheduled_time).toBe('09:30');
    expect(reopened.title).toBe('Ship it');

    vi.setSystemTime(new Date('2026-09-11T13:00:00Z'));
    await repository.setCompletion(id, true);
    expect(sqlite.prepare('SELECT completed_at FROM local_tasks').get()).toEqual({
      completed_at: '2026-09-11T13:00:00.000Z',
    });
  });

  it('rejects invalid edits before writing and updates only changed fields', async () => {
    await repository.create({
      title: 'Keep',
      description: 'Notes',
      priority: 2,
      scheduledDate: '2026-09-12',
      scheduledTime: '10:00',
    });
    const id = loadId(sqlite, 'local_tasks');
    await repository.setCompletion(id, true);
    const completedAt = (
      sqlite.prepare('SELECT completed_at FROM local_tasks').get() as { completed_at: string }
    ).completed_at;

    await expect(repository.update(id, { title: '  ' })).rejects.toThrow();
    expect(sqlite.prepare('SELECT title, completed_at FROM local_tasks').get()).toEqual({
      title: 'Keep',
      completed_at: completedAt,
    });

    const statements: string[] = [];
    writeTransaction.mockImplementation(async (callback: (tx: Transaction) => Promise<unknown>) => {
      sqlite.exec('BEGIN');
      try {
        const result = await callback({
          getOptional: async (sql: string, parameters: SQLInputValue[] = []) =>
            sqlite.prepare(sql).get(...parameters) ?? null,
          execute: async (sql: string, parameters: SQLInputValue[] = []) => {
            statements.push(sql);
            sqlite.prepare(sql).run(...parameters);
            return emptyResult();
          },
        } as unknown as Transaction);
        sqlite.exec('COMMIT');
        return result;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    });

    await repository.update(id, {
      title: 'Renamed',
      description: 'Notes',
      priority: 2,
      scheduledDate: '2026-09-12',
      scheduledTime: '10:00',
    });
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/UPDATE local_tasks SET title = \? WHERE id = \?/);
    expect(statements[0]).not.toMatch(/completed_at/);
    expect(sqlite.prepare('SELECT title, completed_at FROM local_tasks').get()).toEqual({
      title: 'Renamed',
      completed_at: completedAt,
    });
  });

  it('reports missing rows for update, complete, and delete without inserting', async () => {
    await expect(repository.update(MISSING_ID, { title: 'Ghost' })).rejects.toBeInstanceOf(
      TaskNotFoundError,
    );
    await expect(repository.setCompletion(MISSING_ID, true)).rejects.toBeInstanceOf(
      TaskNotFoundError,
    );
    await expect(repository.delete(MISSING_ID)).rejects.toBeInstanceOf(TaskNotFoundError);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM local_tasks').get()).toEqual({ count: 0 });
  });

  it('deletes in one write and restores the original snapshot and id', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-10T08:00:00Z'));
    await repository.create({
      title: 'Original',
      description: 'Keep',
      priority: 1,
      scheduledDate: '2026-09-11',
      scheduledTime: '14:30',
    });
    const id = loadId(sqlite, 'local_tasks');
    vi.setSystemTime(new Date('2026-09-11T15:00:00Z'));
    await repository.setCompletion(id, true);
    const before = sqlite.prepare('SELECT * FROM local_tasks').get();

    const snapshot = await repository.delete(id);
    expect(snapshot).toMatchObject({
      id,
      title: 'Original',
      description: 'Keep',
      priority: 1,
      scheduledDate: '2026-09-11',
      scheduledTime: '14:30',
      completedAt: '2026-09-11T15:00:00.000Z',
      createdAt: '2026-09-10T08:00:00.000Z',
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM local_tasks').get()).toEqual({ count: 0 });

    const statements: string[] = [];
    writeTransaction.mockImplementation(async (callback: (tx: Transaction) => Promise<unknown>) => {
      sqlite.exec('BEGIN');
      try {
        const result = await callback({
          getOptional: async (sql: string, parameters: SQLInputValue[] = []) =>
            sqlite.prepare(sql).get(...parameters) ?? null,
          execute: async (sql: string, parameters: SQLInputValue[] = []) => {
            statements.push(sql);
            sqlite.prepare(sql).run(...parameters);
            return emptyResult();
          },
        } as unknown as Transaction);
        sqlite.exec('COMMIT');
        return result;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    });

    await repository.restore(snapshot);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^INSERT INTO local_tasks/);
    expect(statements[0]).not.toMatch(/OR REPLACE/i);
    expect(sqlite.prepare('SELECT * FROM local_tasks').get()).toEqual(before);
  });

  it('refuses restore when the local id already exists', async () => {
    await repository.create({ title: 'Live' });
    const id = loadId(sqlite, 'local_tasks');
    const snapshot = {
      id,
      title: 'Deleted copy',
      description: '',
      priority: 4 as const,
      scheduledDate: null,
      scheduledTime: null,
      completedAt: null,
      createdAt: '2026-09-01T00:00:00.000Z',
    };
    await expect(repository.restore(snapshot)).rejects.toBeInstanceOf(TaskRestoreConflictError);
    expect(sqlite.prepare('SELECT title FROM local_tasks').get()).toEqual({ title: 'Live' });
  });
});

describe('account-owned task repository', () => {
  const USER_A = '11111111-1111-4111-8111-111111111111';
  const USER_B = '22222222-2222-4222-8222-222222222222';
  let sqlite: DatabaseSync;
  let directory: string;
  const execute =
    vi.fn<(sql: string, parameters?: SQLInputValue[]) => Promise<QueryResult<never>>>();
  const watch = vi.fn<CommonPowerSyncDatabase['watchWithCallback']>();
  const writeTransaction = vi.fn();
  const repositories = createTaskRepositories(
    { execute, watchWithCallback: watch, writeTransaction },
    randomUUID,
  );

  beforeEach(() => {
    vi.resetAllMocks();
    directory = mkdtempSync(join(tmpdir(), 'todoist-user-tasks-'));
    sqlite = new DatabaseSync(join(directory, 'tasks.sqlite'));
    sqlite.exec(`CREATE TABLE tasks (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT, description TEXT, priority INTEGER,
      scheduled_date TEXT, scheduled_time TEXT, completed_at TEXT, created_at TEXT, updated_at TEXT
    )`);
    bindSqlite(sqlite, execute, writeTransaction);
  });

  afterEach(() => {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('writes user_id and updated_at (= created_at) on insert', async () => {
    await repositories.forUser(USER_A).create({
      title: 'Owned',
      scheduledDate: '2026-09-09',
      scheduledTime: '14:30',
    });
    const row = sqlite.prepare('SELECT * FROM tasks').get() as {
      user_id: string;
      created_at: string;
      updated_at: string;
      scheduled_time: string;
      completed_at: string | null;
    };
    expect(row.user_id).toBe(USER_A);
    expect(row.updated_at).toBe(row.created_at);
    expect(row.scheduled_time).toBe('14:30');
    expect(row.completed_at).toBeNull();
  });

  it('filters by user_id and normalizes HH:mm:ss scheduled_time to HH:mm', async () => {
    sqlite
      .prepare(
        `INSERT INTO tasks
        (id, user_id, title, description, priority, scheduled_date, scheduled_time, completed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        USER_A,
        'Mine',
        '',
        4,
        '2026-09-09',
        '14:30:00',
        null,
        '2026-09-09T10:00:00.000Z',
        '2026-09-09T10:00:00.000Z',
      );
    sqlite
      .prepare(
        `INSERT INTO tasks
        (id, user_id, title, description, priority, scheduled_date, scheduled_time, completed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        USER_B,
        'Theirs',
        '',
        4,
        null,
        null,
        '2026-09-09T12:00:00.000Z',
        '2026-09-09T11:00:00.000Z',
        '2026-09-09T11:00:00.000Z',
      );

    watch.mockImplementation((sql, parameters, callback) => {
      const array = sqlite.prepare(sql).all(...(parameters ?? []));
      callback?.onResult({
        array,
        *[Symbol.iterator]() {
          yield* array;
          return undefined;
        },
      });
    });

    const onTasks = vi.fn();
    repositories.forUser(USER_A).subscribe(onTasks, vi.fn());
    expect(onTasks).toHaveBeenCalledOnce();
    expect(onTasks.mock.calls[0]?.[0]).toEqual([
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        title: 'Mine',
        description: '',
        priority: 4,
        scheduledDate: '2026-09-09',
        scheduledTime: '14:30',
        completedAt: null,
        createdAt: '2026-09-09T10:00:00.000Z',
      },
    ]);
  });

  it('scopes update, complete, delete, and restore to the owner', async () => {
    await repositories.forUser(USER_A).create({ title: 'Mine' });
    const id = loadId(sqlite, 'tasks');
    const theirs = repositories.forUser(USER_B);

    await expect(theirs.update(id, { title: 'Stolen' })).rejects.toBeInstanceOf(TaskNotFoundError);
    await expect(theirs.setCompletion(id, true)).rejects.toBeInstanceOf(TaskNotFoundError);
    await expect(theirs.delete(id)).rejects.toBeInstanceOf(TaskNotFoundError);
    expect(sqlite.prepare('SELECT title, user_id FROM tasks').get()).toEqual({
      title: 'Mine',
      user_id: USER_A,
    });

    const snapshot = await repositories.forUser(USER_A).delete(id);
    await theirs.restore({ ...snapshot, title: 'B copy' });
    const restored = sqlite.prepare('SELECT user_id, title FROM tasks').get();
    expect(restored).toEqual({ user_id: USER_B, title: 'B copy' });
  });

  it('refuses restore when the id already exists locally even for another owner', async () => {
    await repositories.forUser(USER_A).create({ title: 'A' });
    const id = loadId(sqlite, 'tasks');
    await expect(
      repositories.forUser(USER_B).restore({
        id,
        title: 'B',
        description: '',
        priority: 4,
        scheduledDate: null,
        scheduledTime: null,
        completedAt: null,
        createdAt: '2026-09-01T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(TaskRestoreConflictError);
    expect(sqlite.prepare('SELECT title, user_id FROM tasks').get()).toEqual({
      title: 'A',
      user_id: USER_A,
    });
  });
});
