export const UPCOMING_PAGE_DAYS = 30;

export type TaskCompletionSelection = 'active' | 'completed';

export type TaskDestination = 'inbox' | 'today' | 'upcoming';

export type TaskViewQuery =
  | { destination: 'inbox'; completion: TaskCompletionSelection }
  | { destination: 'today'; today: string; completion: TaskCompletionSelection }
  | {
      destination: 'upcoming';
      startInclusive: string;
      endExclusive: string;
      completion: TaskCompletionSelection;
    }
  | { destination: 'label'; labelId: string; completion: TaskCompletionSelection };

export type TaskActiveCounts = {
  inbox: number;
  today: number;
};

/** Closed set of view predicates. Dates and owner ids are parameters, never interpolated. */
export function viewPredicate(query: TaskViewQuery): { sql: string; params: string[] } {
  const completion =
    query.completion === 'active' ? 'completed_at IS NULL' : 'completed_at IS NOT NULL';

  switch (query.destination) {
    case 'inbox':
      return { sql: completion, params: [] };
    case 'today':
      return {
        sql: `${completion} AND scheduled_date IS NOT NULL AND scheduled_date <= ?`,
        params: [query.today],
      };
    case 'upcoming':
      return {
        sql: `${completion} AND scheduled_date >= ? AND scheduled_date < ?`,
        params: [query.startInclusive, query.endExclusive],
      };
    case 'label':
      return { sql: completion, params: [] };
  }
}

export function viewOrderSql(query: TaskViewQuery): string {
  if (query.completion === 'completed') {
    return 'ORDER BY completed_at DESC, id DESC';
  }
  if (query.destination === 'inbox' || query.destination === 'label') {
    return 'ORDER BY priority ASC, created_at DESC, id DESC';
  }
  return `ORDER BY scheduled_date ASC, CASE WHEN scheduled_time IS NULL THEN 1 ELSE 0 END ASC, scheduled_time ASC, priority ASC, created_at DESC, id DESC`;
}
