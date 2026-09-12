import type { CommonPowerSyncDatabase } from '@powersync/common';
import {
  parseStoredRecentSearches,
  recentSearchPreferenceId,
  recordRecentSearch,
  removeRecentSearch,
} from './task-search';

export interface RecentSearchRepository {
  subscribe(onRecents: (queries: string[]) => void, onError: (error: Error) => void): () => void;
  record(query: string): Promise<void>;
  remove(query: string): Promise<void>;
  clear(): Promise<void>;
}

export interface RecentSearchRepositories {
  guest: RecentSearchRepository;
  forUser(userId: string): RecentSearchRepository;
}

type RecentsDatabase = Pick<CommonPowerSyncDatabase, 'watchWithCallback' | 'writeTransaction'>;

type PreferenceRow = { value: string };

type RecentsTx = {
  getOptional: CommonPowerSyncDatabase['getOptional'];
  execute: CommonPowerSyncDatabase['execute'];
};

/**
 * Device-local recent search queries in `local_preferences`. Never uploaded,
 * never adopted with guest tasks, and scoped per guest / account identity.
 */
export function createRecentSearchRepositories(
  database: RecentsDatabase,
): RecentSearchRepositories {
  const byUser = new Map<string, RecentSearchRepository>();
  return {
    guest: createRecentSearchRepository(database, recentSearchPreferenceId({ type: 'guest' })),
    forUser(userId) {
      const existing = byUser.get(userId);
      if (existing) return existing;
      const repository = createRecentSearchRepository(
        database,
        recentSearchPreferenceId({ type: 'user', userId }),
      );
      byUser.set(userId, repository);
      return repository;
    },
  };
}

export function createRecentSearchRepository(
  database: RecentsDatabase,
  preferenceId: string,
): RecentSearchRepository {
  return {
    subscribe(onRecents, onError) {
      const expectedId = preferenceId;
      const controller = new AbortController();
      database.watchWithCallback(
        'SELECT value FROM local_preferences WHERE id = ?',
        [expectedId],
        {
          onResult: (result) => {
            if (controller.signal.aborted) return;
            const row = result.array[0] as PreferenceRow | undefined;
            onRecents(parseStoredRecentSearches(row?.value));
          },
          onError: (error) => {
            if (!controller.signal.aborted) onError(error);
          },
        },
        { signal: controller.signal, tables: ['local_preferences'] },
      );
      return () => controller.abort();
    },

    async record(query) {
      const id = preferenceId;
      await database.writeTransaction(async (tx: RecentsTx) => {
        const current = await readRecents(tx, id);
        const next = recordRecentSearch(current, query);
        if (next == null) return;
        await writeRecents(tx, id, next);
      });
    },

    async remove(query) {
      const id = preferenceId;
      await database.writeTransaction(async (tx: RecentsTx) => {
        const current = await readRecents(tx, id);
        const next = removeRecentSearch(current, query);
        await writeRecents(tx, id, next);
      });
    },

    async clear() {
      const id = preferenceId;
      await database.writeTransaction(async (tx: RecentsTx) => {
        await tx.execute('DELETE FROM local_preferences WHERE id = ?', [id]);
      });
    },
  };
}

async function readRecents(tx: RecentsTx, preferenceId: string): Promise<string[]> {
  const row = await tx.getOptional<PreferenceRow>(
    'SELECT value FROM local_preferences WHERE id = ?',
    [preferenceId],
  );
  return parseStoredRecentSearches(row?.value);
}

async function writeRecents(tx: RecentsTx, preferenceId: string, queries: string[]): Promise<void> {
  // PowerSync tables are views; SQLite rejects INSERT … ON CONFLICT DO UPDATE.
  await tx.execute('INSERT OR REPLACE INTO local_preferences (id, value) VALUES (?, ?)', [
    preferenceId,
    JSON.stringify(queries),
  ]);
}
