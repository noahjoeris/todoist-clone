import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type {
  CommonPowerSyncDatabase,
  QueryResult,
  Transaction,
  WatchHandler,
} from '@powersync/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LabelDuplicateNameError, LabelNotFoundError } from './label';
import { createLabelRepositories } from './label-repository';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const MISSING_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function emptyResult(): QueryResult<never> {
  return {
    array: [],
    [Symbol.iterator]: () => [][Symbol.iterator](),
  };
}

function createAccountTables(sqlite: DatabaseSync) {
  sqlite.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT, description TEXT, priority INTEGER,
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
  `);
}

function bindSqlite(
  sqlite: DatabaseSync,
  execute: ReturnType<typeof vi.fn>,
  writeTransaction: ReturnType<typeof vi.fn>,
  getOptional: ReturnType<typeof vi.fn>,
) {
  const runSql = async (sql: string, parameters: SQLInputValue[] = []) => {
    sqlite.prepare(sql).run(...parameters);
    return emptyResult();
  };
  const lookup = async (sql: string, parameters: SQLInputValue[] = []) =>
    sqlite.prepare(sql).get(...parameters) ?? null;
  const list = async (sql: string, parameters: SQLInputValue[] = []) =>
    sqlite.prepare(sql).all(...parameters);

  execute.mockImplementation(runSql);
  getOptional.mockImplementation(lookup);
  writeTransaction.mockImplementation(async (callback: (tx: Transaction) => Promise<unknown>) => {
    sqlite.exec('BEGIN');
    try {
      const result = await callback({
        getOptional: lookup,
        getAll: list,
        execute: runSql,
      } as unknown as Transaction);
      sqlite.exec('COMMIT');
      return result;
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
  });
}

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

describe('account-owned label repository', () => {
  let sqlite: DatabaseSync;
  let directory: string;
  const execute =
    vi.fn<(sql: string, parameters?: SQLInputValue[]) => Promise<QueryResult<never>>>();
  const watch = vi.fn<CommonPowerSyncDatabase['watchWithCallback']>();
  const writeTransaction = vi.fn();
  const getOptional = vi.fn();
  const repositories = createLabelRepositories(
    { watchWithCallback: watch, writeTransaction, getOptional },
    randomUUID,
  );

  beforeEach(() => {
    vi.resetAllMocks();
    directory = mkdtempSync(join(tmpdir(), 'todoist-labels-'));
    sqlite = new DatabaseSync(join(directory, 'labels.sqlite'));
    createAccountTables(sqlite);
    bindSqlite(sqlite, execute, writeTransaction, getOptional);
    bindWatch(sqlite, watch);
  });

  afterEach(() => {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });

  function listed() {
    const onLabels = vi.fn();
    repositories.forUser(USER_A).subscribe(onLabels, vi.fn());
    return onLabels.mock.calls[0]?.[0];
  }

  it('creates trimmed names with charcoal by default and integer favorites', async () => {
    const created = await repositories.forUser(USER_A).create({ name: '  Work  ' });
    const row = sqlite.prepare('SELECT * FROM labels').get() as {
      user_id: string;
      name: string;
      color: string;
      is_favorite: number;
      created_at: string;
      updated_at: string;
    };
    expect(created).toMatchObject({ name: 'Work', color: 'charcoal' });
    expect(row.user_id).toBe(USER_A);
    expect(row.name).toBe('Work');
    expect(row.color).toBe('charcoal');
    expect(row.is_favorite).toBe(0);
    expect(row.updated_at).toBe(row.created_at);
  });

  it('blocks case-insensitive duplicate names locally and looks them up', async () => {
    await repositories.forUser(USER_A).create({ name: 'Work' });
    await expect(repositories.forUser(USER_A).create({ name: ' work ' })).rejects.toBeInstanceOf(
      LabelDuplicateNameError,
    );
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM labels').get()).toEqual({ count: 1 });

    const found = await repositories.forUser(USER_A).findByName('WORK');
    expect(found).toMatchObject({ name: 'Work' });
    expect(await repositories.forUser(USER_A).findByName('Home')).toBeNull();
  });

  it('scopes reads, writes, and lookup to the owner', async () => {
    const work = await repositories.forUser(USER_A).create({ name: 'Work' });
    await repositories.forUser(USER_B).create({ name: 'Work', color: 'blue' });

    expect(await repositories.forUser(USER_B).findByName('Work')).toMatchObject({ color: 'blue' });
    await expect(
      repositories.forUser(USER_B).update(work.id, { name: 'Stolen' }),
    ).rejects.toBeInstanceOf(LabelNotFoundError);
    await expect(repositories.forUser(USER_B).delete(work.id)).rejects.toBeInstanceOf(
      LabelNotFoundError,
    );
    expect(
      sqlite.prepare('SELECT COUNT(*) AS count FROM labels WHERE user_id = ?').get(USER_A),
    ).toEqual({ count: 1 });
  });

  it('updates only changed fields and stores favorite as 0/1', async () => {
    const created = await repositories.forUser(USER_A).create({
      name: 'Work',
      color: 'red',
      isFavorite: false,
    });
    await repositories.forUser(USER_A).update(created.id, { isFavorite: true });
    expect(sqlite.prepare('SELECT name, color, is_favorite FROM labels').get()).toEqual({
      name: 'Work',
      color: 'red',
      is_favorite: 1,
    });

    await repositories.forUser(USER_A).update(created.id, { name: 'Office', color: 'blue' });
    expect(sqlite.prepare('SELECT name, color, is_favorite FROM labels').get()).toEqual({
      name: 'Office',
      color: 'blue',
      is_favorite: 1,
    });
  });

  it('rejects a rename onto another owned name', async () => {
    const work = await repositories.forUser(USER_A).create({ name: 'Work' });
    await repositories.forUser(USER_A).create({ name: 'Home' });
    await expect(
      repositories.forUser(USER_A).update(work.id, { name: 'home' }),
    ).rejects.toBeInstanceOf(LabelDuplicateNameError);
  });

  it('keeps unused labels at zero and counts only active tasks', async () => {
    const work = await repositories.forUser(USER_A).create({ name: 'Work' });
    const home = await repositories.forUser(USER_A).create({ name: 'Home' });
    sqlite
      .prepare(
        `INSERT INTO tasks (id, user_id, title, description, priority, scheduled_date, scheduled_time, completed_at, created_at, updated_at)
         VALUES (?, ?, ?, '', 4, null, null, ?, ?, ?)`,
      )
      .run(
        't-active',
        USER_A,
        'Active',
        null,
        '2026-09-10T08:00:00.000Z',
        '2026-09-10T08:00:00.000Z',
      );
    sqlite
      .prepare(
        `INSERT INTO tasks (id, user_id, title, description, priority, scheduled_date, scheduled_time, completed_at, created_at, updated_at)
         VALUES (?, ?, ?, '', 4, null, null, ?, ?, ?)`,
      )
      .run(
        't-done',
        USER_A,
        'Done',
        '2026-09-11T08:00:00.000Z',
        '2026-09-10T08:00:00.000Z',
        '2026-09-11T08:00:00.000Z',
      );
    sqlite
      .prepare(
        `INSERT INTO tasks (id, user_id, title, description, priority, scheduled_date, scheduled_time, completed_at, created_at, updated_at)
         VALUES (?, ?, ?, '', 4, null, null, null, ?, ?)`,
      )
      .run('t-b', USER_B, 'Other', '2026-09-10T08:00:00.000Z', '2026-09-10T08:00:00.000Z');
    sqlite
      .prepare(
        'INSERT INTO task_labels (id, user_id, task_id, label_id, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run('l1', USER_A, 't-active', work.id, '2026-09-10T08:00:00.000Z');
    sqlite
      .prepare(
        'INSERT INTO task_labels (id, user_id, task_id, label_id, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run('l2', USER_A, 't-done', work.id, '2026-09-10T08:00:00.000Z');
    sqlite
      .prepare(
        'INSERT INTO task_labels (id, user_id, task_id, label_id, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run('l3', USER_B, 't-b', work.id, '2026-09-10T08:00:00.000Z');

    const items = listed() as Array<{ name: string; activeTaskCount: number }>;
    expect(items).toEqual([
      expect.objectContaining({ name: 'Home', activeTaskCount: 0 }),
      expect.objectContaining({ name: 'Work', activeTaskCount: 1 }),
    ]);
    expect(await repositories.forUser(USER_A).countAffectedTasks(work.id)).toBe(2);
    expect(await repositories.forUser(USER_A).countAffectedTasks(home.id)).toBe(0);
  });

  it('deletes association rows with the label in one transaction', async () => {
    const work = await repositories.forUser(USER_A).create({ name: 'Work' });
    sqlite
      .prepare(
        `INSERT INTO tasks (id, user_id, title, description, priority, scheduled_date, scheduled_time, completed_at, created_at, updated_at)
         VALUES (?, ?, ?, '', 4, null, null, null, ?, ?)`,
      )
      .run('t1', USER_A, 'Keep me', '2026-09-10T08:00:00.000Z', '2026-09-10T08:00:00.000Z');
    sqlite
      .prepare(
        'INSERT INTO task_labels (id, user_id, task_id, label_id, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run('link', USER_A, 't1', work.id, '2026-09-10T08:00:00.000Z');

    await repositories.forUser(USER_A).delete(work.id);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM labels').get()).toEqual({ count: 0 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM task_labels').get()).toEqual({ count: 0 });
    expect(sqlite.prepare('SELECT title FROM tasks').get()).toEqual({ title: 'Keep me' });
  });

  it('rolls back label creation when the write fails', async () => {
    writeTransaction.mockImplementationOnce(
      async (callback: (tx: Transaction) => Promise<unknown>) => {
        sqlite.exec('BEGIN');
        try {
          const result = await callback({
            getOptional: async (sql: string, parameters: SQLInputValue[] = []) =>
              sqlite.prepare(sql).get(...parameters) ?? null,
            getAll: async (sql: string, parameters: SQLInputValue[] = []) =>
              sqlite.prepare(sql).all(...parameters),
            execute: async () => {
              throw new Error('Disk full');
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
    await expect(repositories.forUser(USER_A).create({ name: 'Work' })).rejects.toThrow(
      'Disk full',
    );
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM labels').get()).toEqual({ count: 0 });
  });

  it('reports missing labels and does not insert replacements', async () => {
    await expect(
      repositories.forUser(USER_A).update(MISSING_ID, { name: 'Ghost' }),
    ).rejects.toBeInstanceOf(LabelNotFoundError);
    await expect(repositories.forUser(USER_A).delete(MISSING_ID)).rejects.toBeInstanceOf(
      LabelNotFoundError,
    );
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM labels').get()).toEqual({ count: 0 });
  });

  it('lists alphabetically and stops callbacks after unsubscribe', async () => {
    await repositories.forUser(USER_A).create({ name: 'Work' });
    await repositories.forUser(USER_A).create({ name: 'Home' });
    let handler: WatchHandler | undefined;
    watch.mockImplementation((sql, parameters, callback) => {
      handler = callback;
      const array = sqlite.prepare(sql).all(...(parameters ?? []));
      callback?.onResult({
        array,
        *[Symbol.iterator]() {
          yield* array;
          return undefined;
        },
      });
    });
    const onLabels = vi.fn();
    const onError = vi.fn();
    const unsubscribe = repositories.forUser(USER_A).subscribe(onLabels, onError);
    expect(onLabels.mock.calls[0]?.[0].map((label: { name: string }) => label.name)).toEqual([
      'Home',
      'Work',
    ]);
    unsubscribe();
    handler?.onError?.(new Error('after'));
    expect(onError).not.toHaveBeenCalled();
  });
});
