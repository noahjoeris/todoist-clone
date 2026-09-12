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
import {
  MAX_PROJECT_SORT_ORDER,
  MAX_UPLOAD_OPERATIONS,
  ProjectDuplicateNameError,
  ProjectNotFoundError,
  ProjectOperationTooLargeError,
  ProjectStaleListError,
} from './project';
import { createProjectRepositories } from './project-repository';

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
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, project_id TEXT, title TEXT, description TEXT,
      priority INTEGER, scheduled_date TEXT, scheduled_time TEXT, completed_at TEXT,
      created_at TEXT, updated_at TEXT
    );
    CREATE TABLE projects (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, color TEXT NOT NULL,
      is_favorite INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `);
}

function bindSqlite(
  sqlite: DatabaseSync,
  execute: ReturnType<typeof vi.fn>,
  writeTransaction: ReturnType<typeof vi.fn>,
  getOptional: ReturnType<typeof vi.fn>,
  getAll: ReturnType<typeof vi.fn>,
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
  getAll.mockImplementation(list);
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

describe('account-owned project repository', () => {
  let sqlite: DatabaseSync;
  let directory: string;
  const execute =
    vi.fn<(sql: string, parameters?: SQLInputValue[]) => Promise<QueryResult<never>>>();
  const watch = vi.fn<CommonPowerSyncDatabase['watchWithCallback']>();
  const writeTransaction = vi.fn();
  const getOptional = vi.fn();
  const getAll = vi.fn();
  const repositories = createProjectRepositories(
    { watchWithCallback: watch, writeTransaction, getOptional, getAll },
    randomUUID,
  );

  beforeEach(() => {
    vi.resetAllMocks();
    directory = mkdtempSync(join(tmpdir(), 'todoist-projects-'));
    sqlite = new DatabaseSync(join(directory, 'projects.sqlite'));
    createAccountTables(sqlite);
    bindSqlite(sqlite, execute, writeTransaction, getOptional, getAll);
    bindWatch(sqlite, watch);
  });

  afterEach(() => {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });

  function listed() {
    const onProjects = vi.fn();
    repositories.forUser(USER_A).subscribe(onProjects, vi.fn());
    return onProjects.mock.calls[0]?.[0];
  }

  it('creates trimmed names with charcoal by default, integer flags, and appended order', async () => {
    const first = await repositories.forUser(USER_A).create({ name: '  Work  ' });
    const second = await repositories.forUser(USER_A).create({ name: 'Home', isFavorite: true });
    const rows = sqlite.prepare('SELECT * FROM projects ORDER BY sort_order, id').all() as Array<{
      user_id: string;
      name: string;
      color: string;
      is_favorite: number;
      is_archived: number;
      sort_order: number;
      created_at: string;
      updated_at: string;
    }>;
    expect(first).toMatchObject({ name: 'Work', color: 'charcoal', isArchived: false });
    expect(second).toMatchObject({ name: 'Home', color: 'charcoal' });
    expect(rows[0]).toMatchObject({
      user_id: USER_A,
      name: 'Work',
      color: 'charcoal',
      is_favorite: 0,
      is_archived: 0,
      sort_order: 0,
    });
    expect(rows[1]).toMatchObject({ name: 'Home', is_favorite: 1, sort_order: 1 });
    expect(rows[0]?.updated_at).toBe(rows[0]?.created_at);
  });

  it('blocks case-insensitive duplicate names across archived rows and looks them up', async () => {
    const work = await repositories.forUser(USER_A).create({ name: 'Work' });
    await repositories.forUser(USER_A).setArchived(work.id, true);
    await expect(repositories.forUser(USER_A).create({ name: ' work ' })).rejects.toBeInstanceOf(
      ProjectDuplicateNameError,
    );
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM projects').get()).toEqual({ count: 1 });

    const found = await repositories.forUser(USER_A).findByName('WORK');
    expect(found).toMatchObject({ name: 'Work', isArchived: true });
    expect(await repositories.forUser(USER_A).findByName('Home')).toBeNull();
  });

  it('blocks unicode case variants that SQLite lower() would miss', async () => {
    await repositories.forUser(USER_A).create({ name: 'École' });
    await expect(repositories.forUser(USER_A).create({ name: 'école' })).rejects.toBeInstanceOf(
      ProjectDuplicateNameError,
    );
    expect(await repositories.forUser(USER_A).findByName('ÉCOLE')).toMatchObject({ name: 'École' });

    const work = await repositories.forUser(USER_A).create({ name: 'Work' });
    await expect(
      repositories.forUser(USER_A).update(work.id, { name: 'école' }),
    ).rejects.toBeInstanceOf(ProjectDuplicateNameError);

    await expect(repositories.forUser(USER_A).create({ name: 'ecole' })).resolves.toMatchObject({
      name: 'ecole',
    });
  });

  it('scopes reads, writes, and lookup to the owner', async () => {
    const work = await repositories.forUser(USER_A).create({ name: 'Work' });
    await repositories.forUser(USER_B).create({ name: 'Work', color: 'blue' });

    expect(await repositories.forUser(USER_B).findByName('Work')).toMatchObject({ color: 'blue' });
    await expect(
      repositories.forUser(USER_B).update(work.id, { name: 'Stolen' }),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
    await expect(repositories.forUser(USER_B).delete(work.id)).rejects.toBeInstanceOf(
      ProjectNotFoundError,
    );
    expect(
      sqlite.prepare('SELECT COUNT(*) AS count FROM projects WHERE user_id = ?').get(USER_A),
    ).toEqual({ count: 1 });
  });

  it('updates only changed fields and stores flags as 0/1', async () => {
    const created = await repositories.forUser(USER_A).create({
      name: 'Work',
      color: 'red',
      isFavorite: false,
    });
    await repositories.forUser(USER_A).update(created.id, { isFavorite: true });
    expect(sqlite.prepare('SELECT name, color, is_favorite FROM projects').get()).toEqual({
      name: 'Work',
      color: 'red',
      is_favorite: 1,
    });

    await repositories.forUser(USER_A).update(created.id, { name: 'Office', color: 'blue' });
    expect(
      sqlite.prepare('SELECT name, color, is_favorite, is_archived FROM projects').get(),
    ).toEqual({
      name: 'Office',
      color: 'blue',
      is_favorite: 1,
      is_archived: 0,
    });
  });

  it('archives without clearing favorite or order, then restores the same slot', async () => {
    const first = await repositories.forUser(USER_A).create({ name: 'Alpha', isFavorite: true });
    const second = await repositories.forUser(USER_A).create({ name: 'Beta' });
    await repositories.forUser(USER_A).setArchived(first.id, true);
    expect(
      sqlite
        .prepare('SELECT is_archived, is_favorite, sort_order FROM projects WHERE id = ?')
        .get(first.id),
    ).toEqual({
      is_archived: 1,
      is_favorite: 1,
      sort_order: 0,
    });

    const third = await repositories.forUser(USER_A).create({ name: 'Gamma' });
    await repositories.forUser(USER_A).reorder([second.id, third.id]);
    await repositories.forUser(USER_A).setArchived(first.id, false);
    const items = listed() as Array<{ name: string; isArchived: boolean; sortOrder: number }>;
    expect(items.map((project) => project.name)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(items[0]).toMatchObject({ name: 'Alpha', isArchived: false, sortOrder: 0 });
  });

  it('reorders only active slots and preserves archived positions', async () => {
    const a = await repositories.forUser(USER_A).create({ name: 'A' });
    const b = await repositories.forUser(USER_A).create({ name: 'B' });
    const c = await repositories.forUser(USER_A).create({ name: 'C' });
    const d = await repositories.forUser(USER_A).create({ name: 'D' });
    await repositories.forUser(USER_A).setArchived(b.id, true);
    await repositories.forUser(USER_A).reorder([d.id, a.id, c.id]);
    const items = listed() as Array<{ name: string; sortOrder: number }>;
    expect(items.map((project) => project.name)).toEqual(['D', 'B', 'A', 'C']);
    expect(items.map((project) => project.sortOrder)).toEqual([0, 1, 2, 3]);
  });

  it('rejects duplicate, foreign, and stale reorder lists before writing', async () => {
    const a = await repositories.forUser(USER_A).create({ name: 'A' });
    const b = await repositories.forUser(USER_A).create({ name: 'B' });
    const before = sqlite.prepare('SELECT id, sort_order FROM projects ORDER BY sort_order').all();

    await expect(repositories.forUser(USER_A).reorder([a.id, a.id])).rejects.toBeInstanceOf(
      ProjectStaleListError,
    );
    await expect(repositories.forUser(USER_A).reorder([a.id])).rejects.toBeInstanceOf(
      ProjectStaleListError,
    );
    await expect(
      repositories.forUser(USER_A).reorder([a.id, b.id, MISSING_ID]),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
    await repositories.forUser(USER_A).setArchived(b.id, true);
    await expect(repositories.forUser(USER_A).reorder([a.id, b.id])).rejects.toBeInstanceOf(
      ProjectStaleListError,
    );
    expect(sqlite.prepare('SELECT id, sort_order FROM projects ORDER BY sort_order').all()).toEqual(
      before,
    );
  });

  it('writes only changed sort_order values', async () => {
    const a = await repositories.forUser(USER_A).create({ name: 'A' });
    const b = await repositories.forUser(USER_A).create({ name: 'B' });
    const c = await repositories.forUser(USER_A).create({ name: 'C' });
    const statements: string[] = [];
    writeTransaction.mockImplementation(async (callback: (tx: Transaction) => Promise<unknown>) => {
      sqlite.exec('BEGIN');
      try {
        const result = await callback({
          getOptional: async (sql: string, parameters: SQLInputValue[] = []) =>
            sqlite.prepare(sql).get(...parameters) ?? null,
          getAll: async (sql: string, parameters: SQLInputValue[] = []) =>
            sqlite.prepare(sql).all(...parameters),
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
    await repositories.forUser(USER_A).reorder([b.id, a.id, c.id]);
    expect(statements).toHaveLength(2);
    expect(statements.every((sql) => sql.includes('sort_order'))).toBe(true);
  });

  it('compacts sort_order when append would exceed the integer bound', async () => {
    sqlite
      .prepare(
        `INSERT INTO projects (id, user_id, name, color, is_favorite, sort_order, is_archived, created_at, updated_at)
         VALUES (?, ?, ?, 'charcoal', 0, ?, 0, '2026-09-10T08:00:00.000Z', '2026-09-10T08:00:00.000Z')`,
      )
      .run('p-max', USER_A, 'Max', MAX_PROJECT_SORT_ORDER);
    const created = await repositories.forUser(USER_A).create({ name: 'Next' });
    const rows = sqlite
      .prepare('SELECT id, sort_order FROM projects ORDER BY sort_order, id')
      .all() as Array<{ id: string; sort_order: number }>;
    expect(rows).toEqual([
      { id: 'p-max', sort_order: 0 },
      { id: created.id, sort_order: 1 },
    ]);
  });

  it('keeps unused projects at zero and counts active versus total tasks', async () => {
    const work = await repositories.forUser(USER_A).create({ name: 'Work' });
    const home = await repositories.forUser(USER_A).create({ name: 'Home' });
    sqlite
      .prepare(
        `INSERT INTO tasks (id, user_id, project_id, title, description, priority, scheduled_date, scheduled_time, completed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, '', 4, null, null, ?, ?, ?)`,
      )
      .run(
        't-active',
        USER_A,
        work.id,
        'Active',
        null,
        '2026-09-10T08:00:00.000Z',
        '2026-09-10T08:00:00.000Z',
      );
    sqlite
      .prepare(
        `INSERT INTO tasks (id, user_id, project_id, title, description, priority, scheduled_date, scheduled_time, completed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, '', 4, null, null, ?, ?, ?)`,
      )
      .run(
        't-done',
        USER_A,
        work.id,
        'Done',
        '2026-09-11T08:00:00.000Z',
        '2026-09-10T08:00:00.000Z',
        '2026-09-11T08:00:00.000Z',
      );
    sqlite
      .prepare(
        `INSERT INTO tasks (id, user_id, project_id, title, description, priority, scheduled_date, scheduled_time, completed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, '', 4, null, null, null, ?, ?)`,
      )
      .run('t-b', USER_B, work.id, 'Other', '2026-09-10T08:00:00.000Z', '2026-09-10T08:00:00.000Z');

    const items = listed() as Array<{
      name: string;
      activeTaskCount: number;
      totalTaskCount: number;
    }>;
    expect(items).toEqual([
      expect.objectContaining({ name: 'Work', activeTaskCount: 1, totalTaskCount: 2 }),
      expect.objectContaining({ name: 'Home', activeTaskCount: 0, totalTaskCount: 0 }),
    ]);
    expect(await repositories.forUser(USER_A).countAffectedTasks(work.id)).toBe(2);
    expect(await repositories.forUser(USER_A).countAffectedTasks(home.id)).toBe(0);
  });

  it('clears owned task memberships including completed rows, then deletes the project', async () => {
    const work = await repositories.forUser(USER_A).create({ name: 'Work' });
    sqlite
      .prepare(
        `INSERT INTO tasks (id, user_id, project_id, title, description, priority, scheduled_date, scheduled_time, completed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, '', 4, null, null, null, ?, ?)`,
      )
      .run(
        't1',
        USER_A,
        work.id,
        'Keep me',
        '2026-09-10T08:00:00.000Z',
        '2026-09-10T08:00:00.000Z',
      );
    sqlite
      .prepare(
        `INSERT INTO tasks (id, user_id, project_id, title, description, priority, scheduled_date, scheduled_time, completed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, '', 4, null, null, ?, ?, ?)`,
      )
      .run(
        't2',
        USER_A,
        work.id,
        'Done',
        '2026-09-11T08:00:00.000Z',
        '2026-09-10T08:00:00.000Z',
        '2026-09-11T08:00:00.000Z',
      );

    const statements: string[] = [];
    writeTransaction.mockImplementation(async (callback: (tx: Transaction) => Promise<unknown>) => {
      sqlite.exec('BEGIN');
      try {
        const result = await callback({
          getOptional: async (sql: string, parameters: SQLInputValue[] = []) =>
            sqlite.prepare(sql).get(...parameters) ?? null,
          getAll: async (sql: string, parameters: SQLInputValue[] = []) =>
            sqlite.prepare(sql).all(...parameters),
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

    await repositories.forUser(USER_A).delete(work.id);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM projects').get()).toEqual({ count: 0 });
    expect(sqlite.prepare('SELECT project_id FROM tasks ORDER BY title').all()).toEqual([
      { project_id: null },
      { project_id: null },
    ]);
    expect(statements.at(-1)).toMatch(/DELETE FROM projects/);
    expect(statements.some((sql) => sql.includes('UPDATE tasks'))).toBe(true);
  });

  it('fails oversized deletion before mutating', async () => {
    const work = await repositories.forUser(USER_A).create({ name: 'Work' });
    const insert = sqlite.prepare(
      `INSERT INTO tasks (id, user_id, project_id, title, description, priority, scheduled_date, scheduled_time, completed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, '', 4, null, null, null, '2026-09-10T08:00:00.000Z', '2026-09-10T08:00:00.000Z')`,
    );
    for (let index = 0; index < MAX_UPLOAD_OPERATIONS; index += 1) {
      insert.run(`t-${index}`, USER_A, work.id, `Task ${index}`);
    }
    await expect(repositories.forUser(USER_A).delete(work.id)).rejects.toBeInstanceOf(
      ProjectOperationTooLargeError,
    );
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM projects').get()).toEqual({ count: 1 });
    expect(
      sqlite.prepare('SELECT COUNT(*) AS count FROM tasks WHERE project_id IS NOT NULL').get(),
    ).toEqual({ count: MAX_UPLOAD_OPERATIONS });
  });

  it('reports missing projects and does not insert replacements', async () => {
    await expect(
      repositories.forUser(USER_A).update(MISSING_ID, { name: 'Ghost' }),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
    await expect(repositories.forUser(USER_A).delete(MISSING_ID)).rejects.toBeInstanceOf(
      ProjectNotFoundError,
    );
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM projects').get()).toEqual({ count: 0 });
  });

  it('lists in canonical order and stops callbacks after unsubscribe', async () => {
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
    const onProjects = vi.fn();
    const onError = vi.fn();
    const unsubscribe = repositories.forUser(USER_A).subscribe(onProjects, onError);
    expect(onProjects.mock.calls[0]?.[0].map((project: { name: string }) => project.name)).toEqual([
      'Work',
      'Home',
    ]);
    unsubscribe();
    handler?.onError?.(new Error('after'));
    expect(onError).not.toHaveBeenCalled();
  });
});
