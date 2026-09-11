import type { CommonPowerSyncDatabase, QueryResult } from '@powersync/common';

export const GUEST_TASK_ADOPTION_PREF_ID = 'guest-task-adoption';
export const GUEST_TASK_ADOPTION_DISMISSED = 'dismissed';

export type GuestTaskAdoptionState = { status: 'hidden' } | { status: 'offer'; count: number };

export interface GuestTaskAdoptionRepository {
  getState(): GuestTaskAdoptionState;
  subscribe(listener: () => void): () => void;
  /** Copy `local_tasks` into `tasks` with `userId`, preserving ids; delete the originals. */
  adopt(userId: string): Promise<number>;
  /** Hide until the next sign-in. */
  skip(): void;
  dismissForever(): Promise<void>;
  /** Clears the session skip flag; called on sign-out. */
  reset(): void;
}

type AdoptionDatabase = Pick<
  CommonPowerSyncDatabase,
  'writeTransaction' | 'watchWithCallback' | 'getOptional' | 'execute'
>;

type LocalTaskRow = {
  id: string;
  title: string;
  description: string | null;
  priority: number;
  scheduled_date: string | null;
  scheduled_time: string | null;
  created_at: string;
};

type PreferenceRow = { value: string };
type CountRow = { count: number | bigint | string };

/**
 * Offers to copy device-local guest tasks into the signed-in account. Does not
 * convert `local_tasks` in place or upload ownerless rows (ADR-016).
 */
export function createGuestTaskAdoptionRepository(
  database: AdoptionDatabase,
): GuestTaskAdoptionRepository {
  const listeners = new Set<() => void>();
  let skipped = false;
  let dismissed = false;
  let preferenceLoaded = false;
  let count = 0;
  let snapshot: GuestTaskAdoptionState = { status: 'hidden' };

  function derive(): GuestTaskAdoptionState {
    if (!preferenceLoaded || dismissed || skipped || count === 0) return { status: 'hidden' };
    return { status: 'offer', count };
  }

  function notify() {
    const next = derive();
    if (next.status === 'hidden' && snapshot.status === 'hidden') return;
    if (next.status === 'offer' && snapshot.status === 'offer' && next.count === snapshot.count) {
      return;
    }
    snapshot = next;
    for (const listener of listeners) listener();
  }

  void database
    .getOptional<PreferenceRow>('SELECT value FROM local_preferences WHERE id = ?', [
      GUEST_TASK_ADOPTION_PREF_ID,
    ])
    .then((row) => {
      dismissed = row?.value === GUEST_TASK_ADOPTION_DISMISSED;
    })
    .catch(() => {
      dismissed = false;
    })
    .finally(() => {
      preferenceLoaded = true;
      notify();
    });

  database.watchWithCallback('SELECT COUNT(*) AS count FROM local_tasks', [], {
    onResult: (result) => {
      count = countFrom(result);
      notify();
    },
  });

  return {
    getState: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async adopt(userId) {
      const copied = await database.writeTransaction(async (tx) => {
        const rows = await tx.getAll<LocalTaskRow>(
          `SELECT id, title, description, priority, scheduled_date, scheduled_time, created_at
           FROM local_tasks`,
        );
        for (const row of rows) {
          await tx.execute(
            `INSERT INTO tasks
              (id, user_id, title, description, priority, scheduled_date, scheduled_time, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              row.id,
              userId,
              row.title,
              row.description,
              row.priority,
              row.scheduled_date,
              row.scheduled_time,
              row.created_at,
              row.created_at,
            ],
          );
        }
        await tx.execute('DELETE FROM local_tasks');
        return rows.length;
      });
      count = 0;
      notify();
      return copied;
    },

    skip() {
      if (skipped) return;
      skipped = true;
      notify();
    },

    async dismissForever() {
      await database.execute(
        `INSERT INTO local_preferences (id, value) VALUES (?, ?)
         ON CONFLICT(id) DO UPDATE SET value = excluded.value`,
        [GUEST_TASK_ADOPTION_PREF_ID, GUEST_TASK_ADOPTION_DISMISSED],
      );
      dismissed = true;
      notify();
    },

    reset() {
      if (!skipped) return;
      skipped = false;
      notify();
    },
  };
}

function countFrom(result: QueryResult): number {
  const row = result.array[0] as CountRow | undefined;
  const value = row?.count;
  if (value == null) return 0;
  return Number(value);
}
