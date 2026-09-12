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
import { ProjectNotFoundError } from './project';
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
        getAll: async (sql: string, parameters: SQLInputValue[] = []) =>
          sqlite.prepare(sql).all(...parameters),
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

function createAccountTables(sqlite: DatabaseSync) {
  sqlite.exec(`CREATE TABLE tasks (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, project_id TEXT, title TEXT, description TEXT, priority INTEGER,
      scheduled_date TEXT, scheduled_time TEXT, completed_at TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE labels (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, color TEXT NOT NULL,
      is_favorite INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE task_labels (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, task_id TEXT NOT NULL, label_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE projects (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, color TEXT NOT NULL,
      is_favorite INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );`);
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
      labels: [],
      projectId: null,
      project: null,
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
      labels: [],
      projectId: null,
      project: null,
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
    createAccountTables(sqlite);
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
        labels: [],
        projectId: null,
        project: null,
      },
    ]);
  });

  it('maps PowerSync space-separated timestamptz to RFC 3339 so restore PUT is wire-valid', async () => {
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    sqlite
      .prepare(
        `INSERT INTO tasks
        (id, user_id, title, description, priority, scheduled_date, scheduled_time, completed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        USER_A,
        'Synced',
        '',
        4,
        null,
        null,
        '2026-09-11 15:00:00.000Z',
        '2026-09-10 12:00:00.000000Z',
        '2026-09-11 15:00:00.000Z',
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
    expect(onTasks.mock.calls[0]?.[0]).toEqual([
      {
        id,
        title: 'Synced',
        description: '',
        priority: 4,
        scheduledDate: null,
        scheduledTime: null,
        completedAt: '2026-09-11T15:00:00.000Z',
        createdAt: '2026-09-10T12:00:00.000000Z',
        labels: [],
        projectId: null,
        project: null,
      },
    ]);

    const snapshot = await repositories.forUser(USER_A).delete(id);
    expect(snapshot.completedAt).toBe('2026-09-11T15:00:00.000Z');
    expect(snapshot.createdAt).toBe('2026-09-10T12:00:00.000000Z');
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
        labels: [],
        projectId: null,
        project: null,
      }),
    ).rejects.toBeInstanceOf(TaskRestoreConflictError);
    expect(sqlite.prepare('SELECT title, user_id FROM tasks').get()).toEqual({
      title: 'A',
      user_id: USER_A,
    });
  });
});

function bindWatch(sqlite: DatabaseSync, watch: ReturnType<typeof vi.fn>) {
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
}

function insertLocal(
  sqlite: DatabaseSync,
  row: {
    id: string;
    title: string;
    priority?: number;
    scheduledDate?: string | null;
    scheduledTime?: string | null;
    completedAt?: string | null;
    createdAt?: string;
  },
) {
  sqlite
    .prepare(
      `INSERT INTO local_tasks
        (id, title, description, priority, scheduled_date, scheduled_time, completed_at, created_at)
       VALUES (?, ?, '', ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.title,
      row.priority ?? 4,
      row.scheduledDate ?? null,
      row.scheduledTime ?? null,
      row.completedAt ?? null,
      row.createdAt ?? '2026-09-10T08:00:00.000Z',
    );
}

describe('task view queries', () => {
  let sqlite: DatabaseSync;
  let directory: string;
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
    directory = mkdtempSync(join(tmpdir(), 'todoist-task-views-'));
    sqlite = new DatabaseSync(join(directory, 'tasks.sqlite'));
    sqlite.exec(`CREATE TABLE local_tasks (
      id TEXT PRIMARY KEY, title TEXT, description TEXT, priority INTEGER,
      scheduled_date TEXT, scheduled_time TEXT, completed_at TEXT, created_at TEXT
    )`);
    bindSqlite(sqlite, execute, writeTransaction);
    bindWatch(sqlite, watch);
  });

  afterEach(() => {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });

  function titles(query: Parameters<typeof repository.subscribeView>[0]) {
    const onTasks = vi.fn();
    repository.subscribeView(query, onTasks, vi.fn());
    const tasks = onTasks.mock.calls[0]?.[0] as { title: string }[] | undefined;
    if (tasks == null) throw new Error('expected view results');
    return tasks.map((task) => task.title);
  }

  function counts(today: string) {
    const onCounts = vi.fn();
    repository.subscribeActiveCounts(today, onCounts, vi.fn());
    return onCounts.mock.calls[0]?.[0];
  }

  it('keeps scheduled tasks in Inbox and omits unscheduled from Today and Upcoming', () => {
    insertLocal(sqlite, { id: 'u', title: 'Unscheduled' });
    insertLocal(sqlite, { id: 's', title: 'Scheduled', scheduledDate: '2026-09-20' });
    insertLocal(sqlite, { id: 'p', title: 'Past', scheduledDate: '2026-09-10' });
    insertLocal(sqlite, { id: 'n', title: 'Now', scheduledDate: '2026-09-12' });

    expect(titles({ destination: 'inbox', completion: 'active' })).toEqual(
      expect.arrayContaining(['Unscheduled', 'Scheduled', 'Past', 'Now']),
    );
    expect(titles({ destination: 'today', today: '2026-09-12', completion: 'active' })).toEqual([
      'Past',
      'Now',
    ]);
    expect(
      titles({
        destination: 'upcoming',
        startInclusive: '2026-09-13',
        endExclusive: '2026-10-13',
        completion: 'active',
      }),
    ).toEqual(['Scheduled']);
  });

  it('orders Inbox by priority then createdAt, and dated views timed-before-date-only', () => {
    insertLocal(sqlite, {
      id: 'p4-new',
      title: 'P4 new',
      priority: 4,
      createdAt: '2026-09-11T12:00:00.000Z',
    });
    insertLocal(sqlite, {
      id: 'p4-old',
      title: 'P4 old',
      priority: 4,
      createdAt: '2026-09-10T12:00:00.000Z',
    });
    insertLocal(sqlite, {
      id: 'p1',
      title: 'P1',
      priority: 1,
      createdAt: '2026-09-09T12:00:00.000Z',
    });
    expect(titles({ destination: 'inbox', completion: 'active' })).toEqual([
      'P1',
      'P4 new',
      'P4 old',
    ]);

    insertLocal(sqlite, {
      id: 'date-only',
      title: 'Date only',
      scheduledDate: '2026-09-12',
      priority: 1,
    });
    insertLocal(sqlite, {
      id: 'late',
      title: 'Late',
      scheduledDate: '2026-09-12',
      scheduledTime: '18:00',
      priority: 1,
    });
    insertLocal(sqlite, {
      id: 'early',
      title: 'Early',
      scheduledDate: '2026-09-12',
      scheduledTime: '09:00',
      priority: 4,
    });
    insertLocal(sqlite, {
      id: 'overdue',
      title: 'Overdue',
      scheduledDate: '2026-09-11',
      scheduledTime: '23:00',
    });
    expect(titles({ destination: 'today', today: '2026-09-12', completion: 'active' })).toEqual([
      'Overdue',
      'Early',
      'Late',
      'Date only',
    ]);
  });

  it('orders completed by completedAt descending then id, using scheduled date for membership', () => {
    insertLocal(sqlite, {
      id: 'c-future',
      title: 'Future done',
      scheduledDate: '2026-09-20',
      completedAt: '2026-09-12T18:00:00.000Z',
    });
    insertLocal(sqlite, {
      id: 'c-today-b',
      title: 'Today B',
      scheduledDate: '2026-09-12',
      completedAt: '2026-09-12T12:00:00.000Z',
    });
    insertLocal(sqlite, {
      id: 'c-today-a',
      title: 'Today A',
      scheduledDate: '2026-09-12',
      completedAt: '2026-09-12T12:00:00.000Z',
    });
    insertLocal(sqlite, {
      id: 'c-none',
      title: 'Unscheduled done',
      completedAt: '2026-09-12T19:00:00.000Z',
    });

    expect(titles({ destination: 'inbox', completion: 'completed' })).toEqual([
      'Unscheduled done',
      'Future done',
      'Today B',
      'Today A',
    ]);
    expect(titles({ destination: 'today', today: '2026-09-12', completion: 'completed' })).toEqual([
      'Today B',
      'Today A',
    ]);
    expect(
      titles({
        destination: 'upcoming',
        startInclusive: '2026-09-13',
        endExclusive: '2026-10-13',
        completion: 'completed',
      }),
    ).toEqual(['Future done']);
  });

  it('matches live counts to active list predicates and expands upcoming without duplicating', () => {
    insertLocal(sqlite, { id: 'u', title: 'Unscheduled' });
    insertLocal(sqlite, { id: 'over', title: 'Overdue', scheduledDate: '2026-09-10' });
    insertLocal(sqlite, { id: 'now', title: 'Today', scheduledDate: '2026-09-12' });
    insertLocal(sqlite, { id: 'soon', title: 'Soon', scheduledDate: '2026-09-13' });
    insertLocal(sqlite, { id: 'later', title: 'Later', scheduledDate: '2026-10-20' });
    insertLocal(sqlite, {
      id: 'done',
      title: 'Done today',
      scheduledDate: '2026-09-12',
      completedAt: '2026-09-12T10:00:00.000Z',
    });

    expect(counts('2026-09-12')).toEqual({ inbox: 5, today: 2 });

    const firstPage = titles({
      destination: 'upcoming',
      startInclusive: '2026-09-13',
      endExclusive: '2026-10-13',
      completion: 'active',
    });
    const expanded = titles({
      destination: 'upcoming',
      startInclusive: '2026-09-13',
      endExclusive: '2026-11-12',
      completion: 'active',
    });
    expect(firstPage).toEqual(['Soon']);
    expect(expanded).toEqual(['Soon', 'Later']);
    expect(new Set(expanded).size).toBe(expanded.length);
  });

  it('does not mention project_id in guest inbox SQL', () => {
    insertLocal(sqlite, { id: 'u', title: 'Unscheduled' });
    repository.subscribeView({ destination: 'inbox', completion: 'active' }, vi.fn(), vi.fn());
    const sql = String(watch.mock.calls[0]?.[0]);
    expect(sql).not.toMatch(/project_id/);
    repository.subscribeActiveCounts('2026-09-12', vi.fn(), vi.fn());
    expect(String(watch.mock.calls[1]?.[0])).not.toMatch(/project_id/);
  });

  it('watches a guest task by id without treating other rows as a miss', () => {
    insertLocal(sqlite, { id: 'u', title: 'Unscheduled' });
    const onTask = vi.fn();
    repository.subscribeById('u', onTask, vi.fn());
    expect(onTask.mock.calls[0]?.[0]).toMatchObject({ id: 'u', title: 'Unscheduled' });
    repository.subscribeById('missing', onTask, vi.fn());
    expect(onTask.mock.calls.at(-1)?.[0]).toBeNull();
  });

  it('returns no guest tasks for a project destination', () => {
    insertLocal(sqlite, { id: 'u', title: 'Unscheduled' });
    expect(
      titles({
        destination: 'project',
        projectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        completion: 'active',
      }),
    ).toEqual([]);
  });
});

describe('account-owned task view isolation', () => {
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
    directory = mkdtempSync(join(tmpdir(), 'todoist-user-views-'));
    sqlite = new DatabaseSync(join(directory, 'tasks.sqlite'));
    createAccountTables(sqlite);
    bindSqlite(sqlite, execute, writeTransaction);
    bindWatch(sqlite, watch);
  });

  afterEach(() => {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('scopes view lists and counts to the owner', async () => {
    await repositories.forUser(USER_A).create({ title: 'A inbox' });
    await repositories.forUser(USER_A).create({
      title: 'A today',
      scheduledDate: '2026-09-12',
    });
    await repositories.forUser(USER_B).create({
      title: 'B today',
      scheduledDate: '2026-09-12',
    });

    const onTasks = vi.fn();
    repositories
      .forUser(USER_A)
      .subscribeView(
        { destination: 'today', today: '2026-09-12', completion: 'active' },
        onTasks,
        vi.fn(),
      );
    const todayTasks = onTasks.mock.calls[0]?.[0] as { title: string }[] | undefined;
    expect(todayTasks?.map((task) => task.title)).toEqual(['A today']);

    const onCounts = vi.fn();
    repositories.forUser(USER_A).subscribeActiveCounts('2026-09-12', onCounts, vi.fn());
    expect(onCounts.mock.calls[0]?.[0]).toEqual({ inbox: 2, today: 1 });

    const onB = vi.fn();
    repositories.forUser(USER_B).subscribeActiveCounts('2026-09-12', onB, vi.fn());
    expect(onB.mock.calls[0]?.[0]).toEqual({ inbox: 1, today: 1 });
  });
});

describe('account-owned task labels', () => {
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
    directory = mkdtempSync(join(tmpdir(), 'todoist-task-labels-'));
    sqlite = new DatabaseSync(join(directory, 'tasks.sqlite'));
    createAccountTables(sqlite);
    bindSqlite(sqlite, execute, writeTransaction);
    bindWatch(sqlite, watch);
  });

  afterEach(() => {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });

  function insertLabel(row: { id: string; name: string; userId?: string; color?: string }) {
    sqlite
      .prepare(
        `INSERT INTO labels (id, user_id, name, color, is_favorite, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, '2026-09-10T08:00:00.000Z', '2026-09-10T08:00:00.000Z')`,
      )
      .run(row.id, row.userId ?? USER_A, row.name, row.color ?? 'charcoal');
  }

  function titles(query: Parameters<ReturnType<typeof repositories.forUser>['subscribeView']>[0]) {
    const onTasks = vi.fn();
    repositories.forUser(USER_A).subscribeView(query, onTasks, vi.fn());
    const tasks = onTasks.mock.calls[0]?.[0] as { title: string }[] | undefined;
    if (tasks == null) throw new Error('expected view results');
    return tasks.map((task) => task.title);
  }

  it('attaches labels atomically on create and skips missing or duplicate ids', async () => {
    insertLabel({ id: 'lab-work', name: 'Work' });
    insertLabel({ id: 'lab-home', name: 'Home' });
    await repositories
      .forUser(USER_A)
      .create({ title: 'Ship' }, ['lab-work', 'lab-work', MISSING_ID]);
    const taskId = loadId(sqlite, 'tasks');
    const links = sqlite
      .prepare('SELECT label_id FROM task_labels ORDER BY label_id')
      .all() as Array<{
      label_id: string;
    }>;
    expect(links).toEqual([{ label_id: 'lab-work' }]);
    expect(sqlite.prepare('SELECT title FROM tasks').get()).toEqual({ title: 'Ship' });

    const onTasks = vi.fn();
    repositories.forUser(USER_A).subscribe(onTasks, vi.fn());
    expect(onTasks.mock.calls[0]?.[0][0]).toMatchObject({
      title: 'Ship',
      labels: [{ id: 'lab-work', name: 'Work', color: 'charcoal' }],
    });

    await repositories
      .forUser(USER_A)
      .update(
        taskId,
        { title: 'Ship', description: '', priority: 4, scheduledDate: null, scheduledTime: null },
        { labelIds: ['lab-work', 'lab-home'], baselineLabelIds: ['lab-work'] },
      );
    expect(sqlite.prepare('SELECT label_id FROM task_labels ORDER BY label_id').all()).toEqual([
      { label_id: 'lab-home' },
      { label_id: 'lab-work' },
    ]);
  });

  it('does not overwrite remote label changes on a field-only edit', async () => {
    insertLabel({ id: 'lab-work', name: 'Work' });
    insertLabel({ id: 'lab-home', name: 'Home' });
    await repositories.forUser(USER_A).create({ title: 'Ship' }, ['lab-work']);
    const taskId = loadId(sqlite, 'tasks');
    sqlite
      .prepare(
        'INSERT INTO task_labels (id, user_id, task_id, label_id, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run('remote', USER_A, taskId, 'lab-home', '2026-09-10T09:00:00.000Z');

    await repositories.forUser(USER_A).update(taskId, {
      title: 'Renamed',
      description: '',
      priority: 4,
      scheduledDate: null,
      scheduledTime: null,
    });
    expect(
      sqlite
        .prepare('SELECT label_id FROM task_labels ORDER BY label_id')
        .all()
        .map((row) => (row as { label_id: string }).label_id),
    ).toEqual(['lab-home', 'lab-work']);
    expect(sqlite.prepare('SELECT title FROM tasks').get()).toEqual({ title: 'Renamed' });
  });

  it('keeps a remote add when the editor only removes a baseline label', async () => {
    insertLabel({ id: 'lab-work', name: 'Work' });
    insertLabel({ id: 'lab-home', name: 'Home' });
    await repositories.forUser(USER_A).create({ title: 'Ship' }, ['lab-work']);
    const taskId = loadId(sqlite, 'tasks');
    sqlite
      .prepare(
        'INSERT INTO task_labels (id, user_id, task_id, label_id, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run('remote', USER_A, taskId, 'lab-home', '2026-09-10T09:00:00.000Z');

    await repositories
      .forUser(USER_A)
      .update(
        taskId,
        { title: 'Ship', description: '', priority: 4, scheduledDate: null, scheduledTime: null },
        { labelIds: [], baselineLabelIds: ['lab-work'] },
      );
    expect(sqlite.prepare('SELECT label_id FROM task_labels').all()).toEqual([
      { label_id: 'lab-home' },
    ]);
  });

  it('rolls back the task insert when attaching labels fails', async () => {
    insertLabel({ id: 'lab-work', name: 'Work' });
    writeTransaction.mockImplementationOnce(
      async (callback: (tx: Transaction) => Promise<unknown>) => {
        sqlite.exec('BEGIN');
        try {
          const result = await callback({
            getOptional: async (sql: string, parameters: SQLInputValue[] = []) =>
              sqlite.prepare(sql).get(...parameters) ?? null,
            getAll: async (sql: string, parameters: SQLInputValue[] = []) =>
              sqlite.prepare(sql).all(...parameters),
            execute: async (sql: string, parameters: SQLInputValue[] = []) => {
              if (sql.includes('task_labels')) throw new Error('Disk full');
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
      },
    );
    await expect(
      repositories.forUser(USER_A).create({ title: 'Ship' }, ['lab-work']),
    ).rejects.toThrow('Disk full');
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM tasks').get()).toEqual({ count: 0 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM task_labels').get()).toEqual({ count: 0 });
  });

  it('filters the label view with Inbox ordering and includes completed membership', async () => {
    insertLabel({ id: 'lab-work', name: 'Work' });
    insertLabel({ id: 'lab-home', name: 'Home' });
    await repositories.forUser(USER_A).create({ title: 'P4 new', priority: 4 }, ['lab-work']);
    await repositories.forUser(USER_A).create({ title: 'P1', priority: 1 }, ['lab-work']);
    await repositories.forUser(USER_A).create({ title: 'Other' }, ['lab-home']);
    await repositories.forUser(USER_A).create({ title: 'Done' }, ['lab-work']);
    const doneId = sqlite.prepare("SELECT id FROM tasks WHERE title = 'Done'").get() as {
      id: string;
    };
    await repositories.forUser(USER_A).setCompletion(doneId.id, true);

    expect(titles({ destination: 'label', labelId: 'lab-work', completion: 'active' })).toEqual([
      'P1',
      'P4 new',
    ]);
    expect(titles({ destination: 'label', labelId: 'lab-work', completion: 'completed' })).toEqual([
      'Done',
    ]);
    expect(titles({ destination: 'inbox', completion: 'active' })).toEqual(
      expect.arrayContaining(['P1', 'P4 new', 'Other']),
    );
  });

  it('removes local links with the task and restores only surviving owned labels', async () => {
    insertLabel({ id: 'lab-work', name: 'Work' });
    insertLabel({ id: 'lab-gone', name: 'Gone' });
    insertLabel({ id: 'lab-b', name: 'B', userId: USER_B });
    await repositories.forUser(USER_A).create({ title: 'Ship' }, ['lab-work', 'lab-gone']);
    const taskId = loadId(sqlite, 'tasks');
    sqlite
      .prepare(
        'INSERT INTO task_labels (id, user_id, task_id, label_id, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run('cross', USER_A, taskId, 'lab-b', '2026-09-10T09:00:00.000Z');

    const snapshot = await repositories.forUser(USER_A).delete(taskId);
    expect(snapshot.labels.map((label) => label.id).sort()).toEqual(['lab-gone', 'lab-work']);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM tasks').get()).toEqual({ count: 0 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM task_labels').get()).toEqual({ count: 0 });

    sqlite.prepare('DELETE FROM labels WHERE id = ?').run('lab-gone');
    await repositories.forUser(USER_A).restore(snapshot);
    expect(
      sqlite
        .prepare('SELECT label_id FROM task_labels ORDER BY label_id')
        .all()
        .map((row) => (row as { label_id: string }).label_id),
    ).toEqual(['lab-work']);
    expect(
      sqlite.prepare('SELECT COUNT(*) AS count FROM labels WHERE id = ?').get('lab-gone'),
    ).toEqual({ count: 0 });
  });

  it("does not attach another user's label on create", async () => {
    insertLabel({ id: 'lab-b', name: 'B', userId: USER_B });
    await repositories.forUser(USER_A).create({ title: 'Ship' }, ['lab-b']);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM task_labels').get()).toEqual({ count: 0 });
  });
});

describe('account-owned task projects', () => {
  const USER_A = '11111111-1111-4111-8111-111111111111';
  const USER_B = '22222222-2222-4222-8222-222222222222';
  const PROJECT_WORK = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const PROJECT_HOME = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
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
    directory = mkdtempSync(join(tmpdir(), 'todoist-task-projects-'));
    sqlite = new DatabaseSync(join(directory, 'tasks.sqlite'));
    createAccountTables(sqlite);
    bindSqlite(sqlite, execute, writeTransaction);
    bindWatch(sqlite, watch);
    insertProject({ id: PROJECT_WORK, name: 'Work' });
    insertProject({ id: PROJECT_HOME, name: 'Home', color: 'blue' });
  });

  function insertLabel(row: { id: string; name: string; userId?: string; color?: string }) {
    sqlite
      .prepare(
        `INSERT INTO labels (id, user_id, name, color, is_favorite, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, '2026-09-10T08:00:00.000Z', '2026-09-10T08:00:00.000Z')`,
      )
      .run(row.id, row.userId ?? USER_A, row.name, row.color ?? 'charcoal');
  }

  afterEach(() => {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });

  function insertProject(row: {
    id: string;
    name: string;
    userId?: string;
    color?: string;
    archived?: boolean;
  }) {
    sqlite
      .prepare(
        `INSERT INTO projects (id, user_id, name, color, is_favorite, sort_order, is_archived, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, 0, ?, '2026-09-10T08:00:00.000Z', '2026-09-10T08:00:00.000Z')`,
      )
      .run(row.id, row.userId ?? USER_A, row.name, row.color ?? 'charcoal', row.archived ? 1 : 0);
  }

  function titles(query: Parameters<ReturnType<typeof repositories.forUser>['subscribeView']>[0]) {
    const onTasks = vi.fn();
    repositories.forUser(USER_A).subscribeView(query, onTasks, vi.fn());
    const tasks = onTasks.mock.calls[0]?.[0] as { title: string }[] | undefined;
    if (tasks == null) throw new Error('expected view results');
    return tasks.map((task) => task.title);
  }

  function counts(today: string) {
    const onCounts = vi.fn();
    repositories.forUser(USER_A).subscribeActiveCounts(today, onCounts, vi.fn());
    return onCounts.mock.calls[0]?.[0];
  }

  it('creates into a project and treats omitted membership as Inbox', async () => {
    await repositories.forUser(USER_A).create({ title: 'Inbox' });
    await repositories.forUser(USER_A).create({ title: 'Work task' }, [], PROJECT_WORK);
    expect(sqlite.prepare('SELECT title, project_id FROM tasks ORDER BY title').all()).toEqual([
      { title: 'Inbox', project_id: null },
      { title: 'Work task', project_id: PROJECT_WORK },
    ]);
  });

  it('rejects a missing or foreign project before writing', async () => {
    await expect(
      repositories.forUser(USER_A).create({ title: 'Nope' }, [], MISSING_ID),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
    await expect(
      repositories.forUser(USER_A).create({ title: 'Nope' }, [], PROJECT_WORK),
    ).resolves.toBeUndefined();
    sqlite.prepare('DELETE FROM tasks').run();
    insertProject({ id: 'p-b', name: 'Theirs', userId: USER_B });
    await expect(
      repositories.forUser(USER_A).create({ title: 'Nope' }, [], 'p-b'),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM tasks').get()).toEqual({ count: 0 });
  });

  it('allows an in-flight archived destination and explicit Inbox move', async () => {
    sqlite.prepare('UPDATE projects SET is_archived = 1 WHERE id = ?').run(PROJECT_WORK);
    await repositories.forUser(USER_A).create({ title: 'Archived dest' }, [], PROJECT_WORK);
    const id = loadId(sqlite, 'tasks');
    await repositories.forUser(USER_A).update(
      id,
      {
        title: 'Archived dest',
        description: '',
        priority: 4,
        scheduledDate: null,
        scheduledTime: null,
      },
      undefined,
      { projectId: null },
    );
    expect(sqlite.prepare('SELECT project_id FROM tasks').get()).toEqual({ project_id: null });
  });

  it('does not overwrite a remote project move on a field-only edit', async () => {
    await repositories.forUser(USER_A).create({ title: 'Ship' }, [], PROJECT_WORK);
    const id = loadId(sqlite, 'tasks');
    sqlite.prepare('UPDATE tasks SET project_id = ? WHERE id = ?').run(PROJECT_HOME, id);
    await repositories.forUser(USER_A).update(id, {
      title: 'Renamed',
      description: '',
      priority: 4,
      scheduledDate: null,
      scheduledTime: null,
    });
    expect(sqlite.prepare('SELECT title, project_id FROM tasks').get()).toEqual({
      title: 'Renamed',
      project_id: PROJECT_HOME,
    });
  });

  it('counts only null-membership Inbox tasks and keeps Today cross-project', async () => {
    await repositories.forUser(USER_A).create({ title: 'Inbox undated' });
    await repositories
      .forUser(USER_A)
      .create({ title: 'Inbox today', scheduledDate: '2026-09-12' }, [], null);
    await repositories
      .forUser(USER_A)
      .create({ title: 'Work today', scheduledDate: '2026-09-12' }, [], PROJECT_WORK);
    sqlite.prepare('UPDATE projects SET is_archived = 1 WHERE id = ?').run(PROJECT_WORK);

    expect(titles({ destination: 'inbox', completion: 'active' })).toEqual(
      expect.arrayContaining(['Inbox today', 'Inbox undated']),
    );
    expect(titles({ destination: 'inbox', completion: 'active' })).toHaveLength(2);
    expect(titles({ destination: 'today', today: '2026-09-12', completion: 'active' })).toEqual(
      expect.arrayContaining(['Inbox today', 'Work today']),
    );
    expect(
      titles({ destination: 'today', today: '2026-09-12', completion: 'active' }),
    ).toHaveLength(2);
    expect(
      titles({ destination: 'project', projectId: PROJECT_WORK, completion: 'active' }),
    ).toEqual(['Work today']);
    expect(counts('2026-09-12')).toEqual({ inbox: 2, today: 2 });
  });

  it('orders project views like Inbox and includes completed membership', async () => {
    await repositories.forUser(USER_A).create({ title: 'P4 new', priority: 4 }, [], PROJECT_WORK);
    await repositories.forUser(USER_A).create({ title: 'P1', priority: 1 }, [], PROJECT_WORK);
    await repositories.forUser(USER_A).create({ title: 'Other' }, [], PROJECT_HOME);
    await repositories.forUser(USER_A).create({ title: 'Done' }, [], PROJECT_WORK);
    const doneId = sqlite.prepare("SELECT id FROM tasks WHERE title = 'Done'").get() as {
      id: string;
    };
    await repositories.forUser(USER_A).setCompletion(doneId.id, true);

    expect(
      titles({ destination: 'project', projectId: PROJECT_WORK, completion: 'active' }),
    ).toEqual(['P1', 'P4 new']);
    expect(
      titles({ destination: 'project', projectId: PROJECT_WORK, completion: 'completed' }),
    ).toEqual(['Done']);
  });

  it('keeps a stored project_id when the summary join is missing', async () => {
    await repositories.forUser(USER_A).create({ title: 'Orphan' }, [], PROJECT_WORK);
    sqlite.prepare('DELETE FROM projects WHERE id = ?').run(PROJECT_WORK);
    const onTasks = vi.fn();
    repositories.forUser(USER_A).subscribe(onTasks, vi.fn());
    expect(onTasks.mock.calls[0]?.[0][0]).toMatchObject({
      title: 'Orphan',
      projectId: PROJECT_WORK,
      project: null,
    });
    expect(titles({ destination: 'inbox', completion: 'active' })).toEqual([]);
  });

  it('propagates live project rename and color through the task watch', async () => {
    await repositories.forUser(USER_A).create({ title: 'Ship' }, [], PROJECT_WORK);
    const onTasks = vi.fn();
    repositories.forUser(USER_A).subscribe(onTasks, vi.fn());
    expect(onTasks.mock.calls[0]?.[0][0]).toMatchObject({
      project: { id: PROJECT_WORK, name: 'Work', color: 'charcoal', isArchived: false },
    });
    sqlite
      .prepare('UPDATE projects SET name = ?, color = ? WHERE id = ?')
      .run('Office', 'red', PROJECT_WORK);
    const sql = String(watch.mock.calls[0]?.[0]);
    const parameters = watch.mock.calls[0]?.[1] as SQLInputValue[];
    const array = sqlite.prepare(sql).all(...parameters);
    watch.mock.calls[0]?.[2]?.onResult?.({
      array,
      *[Symbol.iterator]() {
        yield* array;
        return undefined;
      },
    });
    expect(onTasks.mock.calls.at(-1)?.[0][0]).toMatchObject({
      project: { id: PROJECT_WORK, name: 'Office', color: 'red' },
    });
  });

  it('keeps a by-id watch after the task leaves the current view', async () => {
    await repositories.forUser(USER_A).create({ title: 'Inbox' });
    const id = loadId(sqlite, 'tasks');
    const onTask = vi.fn();
    repositories.forUser(USER_A).subscribeById(id, onTask, vi.fn());
    expect(onTask.mock.calls[0]?.[0]).toMatchObject({ id, title: 'Inbox', projectId: null });

    sqlite.prepare('UPDATE tasks SET project_id = ? WHERE id = ?').run(PROJECT_WORK, id);
    const sql = String(watch.mock.calls[0]?.[0]);
    const parameters = watch.mock.calls[0]?.[1] as SQLInputValue[];
    const array = sqlite.prepare(sql).all(...parameters);
    watch.mock.calls[0]?.[2]?.onResult?.({
      array,
      *[Symbol.iterator]() {
        yield* array;
        return undefined;
      },
    });
    expect(onTask.mock.calls.at(-1)?.[0]).toMatchObject({
      id,
      title: 'Inbox',
      projectId: PROJECT_WORK,
    });

    sqlite.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    const gone = sqlite.prepare(sql).all(...parameters);
    watch.mock.calls[0]?.[2]?.onResult?.({
      array: gone,
      *[Symbol.iterator]() {
        yield* gone;
        return undefined;
      },
    });
    expect(onTask.mock.calls.at(-1)?.[0]).toBeNull();
  });

  it('restores membership only when the owned project still exists', async () => {
    insertLabel({ id: 'lab-work', name: 'Work' });
    await repositories.forUser(USER_A).create({ title: 'Ship' }, ['lab-work'], PROJECT_WORK);
    const snapshot = await repositories.forUser(USER_A).delete(loadId(sqlite, 'tasks'));
    expect(snapshot.projectId).toBe(PROJECT_WORK);
    sqlite.prepare('DELETE FROM projects WHERE id = ?').run(PROJECT_WORK);
    await repositories.forUser(USER_A).restore(snapshot);
    expect(sqlite.prepare('SELECT project_id FROM tasks').get()).toEqual({ project_id: null });
    expect(sqlite.prepare('SELECT label_id FROM task_labels').all()).toEqual([
      { label_id: 'lab-work' },
    ]);
  });
});
