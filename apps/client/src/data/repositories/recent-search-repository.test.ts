import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { QueryResult, Transaction } from '@powersync/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRecentSearchRepositories } from './recent-search-repository';
import { recentSearchPreferenceId } from './task-search';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

function emptyResult(): QueryResult<never> {
  return {
    array: [],
    [Symbol.iterator]: () => [][Symbol.iterator](),
  };
}

function queryResult<T>(array: T[]): QueryResult<T> {
  return {
    array,
    *[Symbol.iterator]() {
      yield* array;
      return undefined;
    },
  };
}

describe('recent search repository', () => {
  let sqlite: DatabaseSync;
  let directory: string;
  let emitWatch: () => void = () => {};

  const watch = vi.fn();
  const writeTransaction = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    directory = mkdtempSync(join(tmpdir(), 'todoist-recents-'));
    sqlite = new DatabaseSync(join(directory, 'recents.sqlite'));
    sqlite.exec(`
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
    `);

    type Watcher = {
      sql: string;
      parameters: SQLInputValue[];
      handler: { onResult?: (result: QueryResult) => void; onError?: (error: Error) => void };
      signal?: AbortSignal;
    };
    const watchers: Watcher[] = [];
    watch.mockImplementation(
      (sql: string, parameters: SQLInputValue[] | undefined, handler, options) => {
        const watcher: Watcher = {
          sql,
          parameters: parameters ?? [],
          handler,
          signal: options?.signal,
        };
        watchers.push(watcher);
        emitWatch = () => {
          for (const item of watchers) {
            if (item.signal?.aborted) continue;
            const array = sqlite.prepare(item.sql).all(...item.parameters);
            item.handler.onResult?.(queryResult(array));
          }
        };
        emitWatch();
      },
    );
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
    return { watchWithCallback: watch, writeTransaction };
  }

  it('rejects INSERT ... ON CONFLICT DO UPDATE against the preference view', () => {
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO local_preferences (id, value) VALUES (?, ?)
           ON CONFLICT(id) DO UPDATE SET value = excluded.value`,
        )
        .run('search-recents:guest', '[]'),
    ).toThrow(/cannot UPSERT a view/i);
    sqlite
      .prepare('INSERT OR REPLACE INTO local_preferences (id, value) VALUES (?, ?)')
      .run('search-recents:guest', '["ok"]');
    expect(
      sqlite
        .prepare('SELECT value FROM local_preferences WHERE id = ?')
        .get('search-recents:guest'),
    ).toEqual({ value: '["ok"]' });
  });

  it('records, deduplicates, caps, removes, and clears per identity', async () => {
    const repositories = createRecentSearchRepositories(database());
    const guest = repositories.guest;
    const userA = repositories.forUser(USER_A);
    const onGuest = vi.fn();
    const onA = vi.fn();
    guest.subscribe(onGuest, vi.fn());
    userA.subscribe(onA, vi.fn());
    expect(onGuest.mock.calls[0]?.[0]).toEqual([]);

    await guest.record('one');
    await guest.record('two');
    await guest.record('three');
    await guest.record('four');
    await guest.record('five');
    await guest.record('six');
    await guest.record('  TWO  ');
    expect(onGuest.mock.calls.at(-1)?.[0]).toEqual(['TWO', 'six', 'five', 'four', 'three']);

    await userA.record('account query');
    expect(onA.mock.calls.at(-1)?.[0]).toEqual(['account query']);
    expect(
      sqlite
        .prepare('SELECT id FROM local_preferences ORDER BY id')
        .all()
        .map((row) => (row as { id: string }).id),
    ).toEqual([
      recentSearchPreferenceId({ type: 'guest' }),
      recentSearchPreferenceId({ type: 'user', userId: USER_A }),
    ]);

    await guest.remove('six');
    expect(onGuest.mock.calls.at(-1)?.[0]).toEqual(['TWO', 'five', 'four', 'three']);
    await guest.clear();
    expect(onGuest.mock.calls.at(-1)?.[0]).toEqual([]);
    expect(onA.mock.calls.at(-1)?.[0]).toEqual(['account query']);
  });

  it('recovers from malformed JSON and does not touch other preference keys', async () => {
    sqlite
      .prepare('INSERT OR REPLACE INTO local_preferences (id, value) VALUES (?, ?)')
      .run('guest-task-adoption', 'dismissed');
    sqlite
      .prepare('INSERT OR REPLACE INTO local_preferences (id, value) VALUES (?, ?)')
      .run(recentSearchPreferenceId({ type: 'guest' }), '{bad');
    const guest = createRecentSearchRepositories(database()).guest;
    const onRecents = vi.fn();
    guest.subscribe(onRecents, vi.fn());
    expect(onRecents.mock.calls[0]?.[0]).toEqual([]);
    await guest.record('later');
    expect(
      sqlite.prepare('SELECT value FROM local_preferences WHERE id = ?').get('guest-task-adoption'),
    ).toEqual({ value: 'dismissed' });
    expect(onRecents.mock.calls.at(-1)?.[0]).toEqual(['later']);
  });

  it('keeps account histories isolated and ignores callbacks after unsubscribe', async () => {
    const repositories = createRecentSearchRepositories(database());
    const onA = vi.fn();
    const onB = vi.fn();
    const stopA = repositories.forUser(USER_A).subscribe(onA, vi.fn());
    repositories.forUser(USER_B).subscribe(onB, vi.fn());
    await repositories.forUser(USER_A).record('alpha');
    await repositories.forUser(USER_B).record('beta');
    expect(onA.mock.calls.at(-1)?.[0]).toEqual(['alpha']);
    expect(onB.mock.calls.at(-1)?.[0]).toEqual(['beta']);
    stopA();
    await repositories.forUser(USER_A).record('gamma');
    expect(onA.mock.calls.at(-1)?.[0]).toEqual(['alpha']);
  });

  it('does not write tasks or upload rows when recording recents', async () => {
    sqlite.exec(`CREATE TABLE tasks (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT
    );
    CREATE TABLE ps_crud (id INTEGER PRIMARY KEY, data TEXT);`);
    const guest = createRecentSearchRepositories(database()).guest;
    await guest.record('query');
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM tasks').get()).toEqual({ count: 0 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM ps_crud').get()).toEqual({ count: 0 });
  });
});
