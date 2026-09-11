import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { QueryResult, Transaction } from '@powersync/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createGuestTaskAdoptionRepository,
  GUEST_TASK_ADOPTION_DISMISSED,
  GUEST_TASK_ADOPTION_PREF_ID,
  type GuestTaskAdoptionRepository,
  type GuestTaskAdoptionState,
} from './guest-task-adoption';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const TASK_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TASK_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('guest-task adoption', () => {
  let sqlite: DatabaseSync;
  let directory: string;
  let emitWatch: () => void = () => {};

  const getOptional = vi.fn();
  const execute = vi.fn();
  const watch = vi.fn();
  const writeTransaction = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    directory = mkdtempSync(join(tmpdir(), 'todoist-adoption-'));
    sqlite = new DatabaseSync(join(directory, 'adoption.sqlite'));
    sqlite.exec(`
      CREATE TABLE local_tasks (
        id TEXT PRIMARY KEY, title TEXT, description TEXT, priority INTEGER,
        scheduled_date TEXT, scheduled_time TEXT, created_at TEXT
      );
      CREATE TABLE ps_data_local__local_preferences (
        id TEXT NOT NULL PRIMARY KEY,
        data TEXT
      );
      CREATE VIEW local_preferences AS
        SELECT id, CAST(json_extract(data, '$.value') AS TEXT) AS value
        FROM ps_data_local__local_preferences;
      CREATE TRIGGER ps_view_insert_local_preferences
        INSTEAD OF INSERT ON local_preferences
      BEGIN
        INSERT OR REPLACE INTO ps_data_local__local_preferences (id, data)
        VALUES (NEW.id, json_object('value', NEW.value));
      END;
      CREATE TRIGGER ps_view_update_local_preferences
        INSTEAD OF UPDATE ON local_preferences
      BEGIN
        INSERT OR REPLACE INTO ps_data_local__local_preferences (id, data)
        VALUES (NEW.id, json_object('value', NEW.value));
      END;
      CREATE TRIGGER ps_view_delete_local_preferences
        INSTEAD OF DELETE ON local_preferences
      BEGIN
        DELETE FROM ps_data_local__local_preferences WHERE id = OLD.id;
      END;
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT, description TEXT, priority INTEGER,
        scheduled_date TEXT, scheduled_time TEXT, created_at TEXT, updated_at TEXT
      );
    `);

    getOptional.mockImplementation(async (sql: string, parameters: SQLInputValue[] = []) => {
      const row = sqlite.prepare(sql).get(...parameters);
      return row ?? null;
    });
    execute.mockImplementation(async (sql: string, parameters: SQLInputValue[] = []) => {
      sqlite.prepare(sql).run(...parameters);
      return emptyResult();
    });
    watch.mockImplementation((sql: string, parameters: SQLInputValue[] | undefined, handler) => {
      emitWatch = () => {
        const array = sqlite.prepare(sql).all(...(parameters ?? []));
        handler?.onResult(queryResult(array));
      };
      emitWatch();
    });
    writeTransaction.mockImplementation(async (callback: (tx: Transaction) => Promise<unknown>) => {
      sqlite.exec('BEGIN');
      try {
        const result = await callback({
          getAll: async (sql: string, parameters: SQLInputValue[] = []) =>
            sqlite.prepare(sql).all(...parameters),
          execute: async (sql: string, parameters: SQLInputValue[] = []) => {
            sqlite.prepare(sql).run(...parameters);
            return emptyResult();
          },
        } as unknown as Transaction);
        sqlite.exec('COMMIT');
        emitWatch();
        return result;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    });
  });

  afterEach(() => {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });

  function database() {
    return {
      getOptional,
      execute,
      watchWithCallback: watch,
      writeTransaction,
    };
  }

  async function createRepository(): Promise<GuestTaskAdoptionRepository> {
    const repository = createGuestTaskAdoptionRepository(database());
    // getOptional is async; drain its then/finally before reading state.
    await new Promise((resolve) => setTimeout(resolve, 0));
    return repository;
  }

  it('hides the offer when there are no guest tasks', async () => {
    const repository = await createRepository();
    expect(repository.getState()).toEqual({ status: 'hidden' });
  });

  it('offers the live guest-task count', async () => {
    insertLocalTask({ id: TASK_A, title: 'First' });
    const repository = await createRepository();
    expect(repository.getState()).toEqual({ status: 'offer', count: 1 });

    insertLocalTask({ id: TASK_B, title: 'Second' });
    emitWatch();
    expect(repository.getState()).toEqual({ status: 'offer', count: 2 });
  });

  it('copies fields and ids into tasks then clears local_tasks', async () => {
    insertLocalTask({
      id: TASK_A,
      title: 'Buy milk',
      description: '2%',
      priority: 1,
      scheduled_date: '2026-09-09',
      scheduled_time: '08:30',
      created_at: '2026-09-08T10:00:00.000Z',
    });
    insertLocalTask({
      id: TASK_B,
      title: 'Date only',
      created_at: '2026-09-08T11:00:00.000Z',
    });

    const repository = await createRepository();
    const copied = await repository.adopt(USER_ID);

    expect(copied).toBe(2);
    expect(writeTransaction).toHaveBeenCalledOnce();
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM local_tasks').get()).toEqual({ count: 0 });
    expect(repository.getState()).toEqual({ status: 'hidden' });

    const rows = sqlite.prepare('SELECT * FROM tasks ORDER BY created_at').all();
    expect(rows).toEqual([
      {
        id: TASK_A,
        user_id: USER_ID,
        title: 'Buy milk',
        description: '2%',
        priority: 1,
        scheduled_date: '2026-09-09',
        scheduled_time: '08:30',
        created_at: '2026-09-08T10:00:00.000Z',
        updated_at: '2026-09-08T10:00:00.000Z',
      },
      {
        id: TASK_B,
        user_id: USER_ID,
        title: 'Date only',
        description: '',
        priority: 4,
        scheduled_date: null,
        scheduled_time: null,
        created_at: '2026-09-08T11:00:00.000Z',
        updated_at: '2026-09-08T11:00:00.000Z',
      },
    ]);
  });

  it('rolls back local_tasks when an insert fails', async () => {
    insertLocalTask({ id: TASK_A, title: 'Keep me' });
    sqlite
      .prepare(
        `INSERT INTO tasks
          (id, user_id, title, description, priority, scheduled_date, scheduled_time, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        TASK_A,
        USER_ID,
        'Existing',
        '',
        4,
        null,
        null,
        '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
      );

    const repository = await createRepository();
    await expect(repository.adopt(USER_ID)).rejects.toThrow();

    expect(sqlite.prepare('SELECT id, title FROM local_tasks').all()).toEqual([
      { id: TASK_A, title: 'Keep me' },
    ]);
    expect(sqlite.prepare('SELECT id, title FROM tasks').all()).toEqual([
      { id: TASK_A, title: 'Existing' },
    ]);
    expect(repository.getState()).toEqual({ status: 'offer', count: 1 });
  });

  it('persists dismiss in local_preferences', async () => {
    insertLocalTask({ id: TASK_A, title: 'Later' });
    const repository = await createRepository();

    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO local_preferences (id, value) VALUES (?, ?)
           ON CONFLICT(id) DO UPDATE SET value = excluded.value`,
        )
        .run(GUEST_TASK_ADOPTION_PREF_ID, GUEST_TASK_ADOPTION_DISMISSED),
    ).toThrow(/cannot UPSERT a view/i);

    await repository.dismissForever();

    expect(repository.getState()).toEqual({ status: 'hidden' });
    expect(sqlite.prepare('SELECT id, value FROM local_preferences').all()).toEqual([
      { id: GUEST_TASK_ADOPTION_PREF_ID, value: GUEST_TASK_ADOPTION_DISMISSED },
    ]);

    const again = await createRepository();
    expect(again.getState()).toEqual({ status: 'hidden' });
    again.reset();
    expect(again.getState()).toEqual({ status: 'hidden' });

    await again.dismissForever();
    expect(sqlite.prepare('SELECT id, value FROM local_preferences').all()).toEqual([
      { id: GUEST_TASK_ADOPTION_PREF_ID, value: GUEST_TASK_ADOPTION_DISMISSED },
    ]);
  });

  it('treats skip as session-only and re-offers after reset', async () => {
    insertLocalTask({ id: TASK_A, title: 'Still here' });
    const repository = await createRepository();
    const seen: GuestTaskAdoptionState[] = [];
    repository.subscribe(() => {
      seen.push(repository.getState());
    });

    repository.skip();
    expect(repository.getState()).toEqual({ status: 'hidden' });
    expect(sqlite.prepare('SELECT * FROM local_preferences').all()).toEqual([]);

    repository.reset();
    expect(repository.getState()).toEqual({ status: 'offer', count: 1 });
    expect(seen).toEqual([{ status: 'hidden' }, { status: 'offer', count: 1 }]);
  });

  function insertLocalTask(row: {
    id: string;
    title: string;
    description?: string;
    priority?: number;
    scheduled_date?: string | null;
    scheduled_time?: string | null;
    created_at?: string;
  }) {
    sqlite
      .prepare(
        `INSERT INTO local_tasks
          (id, title, description, priority, scheduled_date, scheduled_time, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.title,
        row.description ?? '',
        row.priority ?? 4,
        row.scheduled_date ?? null,
        row.scheduled_time ?? null,
        row.created_at ?? '2026-09-08T10:00:00.000Z',
      );
  }
});

function queryResult(array: unknown[]): QueryResult {
  return {
    array,
    *[Symbol.iterator]() {
      yield* array;
      return undefined;
    },
  } as QueryResult;
}

function emptyResult(): QueryResult<never> {
  return queryResult([]) as QueryResult<never>;
}
