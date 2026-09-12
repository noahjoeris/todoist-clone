/** Keyword search over local task titles and descriptions. No filter-language operators. */

export const MAX_SEARCH_QUERY_LENGTH = 200;
export const SEARCH_PAGE_SIZE = 50;
export const SEARCH_TOP_COUNT = 5;
export const MAX_RECENT_SEARCHES = 5;
export const SEARCH_LIKE_ESCAPE = '\\';

export type ParsedSearchQuery =
  | { status: 'blank' }
  | { status: 'invalid'; reason: 'too-long' }
  | { status: 'ready'; normalized: string; words: readonly string[] };

export type CompiledSearchSql = {
  sql: string;
  parameters: string[];
  fetchLimit: number;
};

/**
 * Trim and collapse internal whitespace. Display form for recents; ranking uses
 * this complete string for exact/prefix title matches.
 */
export function normalizeSearchQuery(raw: string): string {
  return raw.trim().replaceAll(/\s+/g, ' ');
}

/** ASCII A–Z only. Non-ASCII letters stay as written (no Unicode folding). */
export function searchQueryIdentity(normalized: string): string {
  return normalized.replaceAll(/[A-Z]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) + 32),
  );
}

export function parseSearchQuery(raw: string): ParsedSearchQuery {
  if (raw.length > MAX_SEARCH_QUERY_LENGTH) return { status: 'invalid', reason: 'too-long' };
  const normalized = normalizeSearchQuery(raw);
  if (normalized === '') return { status: 'blank' };
  return { status: 'ready', normalized, words: normalized.split(' ') };
}

export function escapeLikeLiteral(value: string): string {
  return value
    .replaceAll(SEARCH_LIKE_ESCAPE, SEARCH_LIKE_ESCAPE + SEARCH_LIKE_ESCAPE)
    .replaceAll('%', `${SEARCH_LIKE_ESCAPE}%`)
    .replaceAll('_', `${SEARCH_LIKE_ESCAPE}_`);
}

export function containsLikePattern(value: string): string {
  return `%${escapeLikeLiteral(value)}%`;
}

export function prefixLikePattern(value: string): string {
  return `${escapeLikeLiteral(value)}%`;
}

export function parseStoredRecentSearches(value: string | null | undefined): string[] {
  if (value == null || value === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const entry of parsed) {
    if (typeof entry !== 'string') continue;
    const query = parseSearchQuery(entry);
    if (query.status !== 'ready') continue;
    const identity = searchQueryIdentity(query.normalized);
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push(query.normalized);
    if (result.length >= MAX_RECENT_SEARCHES) break;
  }
  return result;
}

/** Newest first. Returns null when the query is blank or too long (no write). */
export function recordRecentSearch(current: readonly string[], raw: string): string[] | null {
  const query = parseSearchQuery(raw);
  if (query.status !== 'ready') return null;
  const identity = searchQueryIdentity(query.normalized);
  return [
    query.normalized,
    ...current.filter((item) => searchQueryIdentity(normalizeSearchQuery(item)) !== identity),
  ].slice(0, MAX_RECENT_SEARCHES);
}

export function removeRecentSearch(current: readonly string[], raw: string): string[] {
  const identity = searchQueryIdentity(normalizeSearchQuery(raw));
  if (identity === '') return [...current];
  return current.filter((item) => searchQueryIdentity(normalizeSearchQuery(item)) !== identity);
}

export function recentSearchPreferenceId(
  scope: { type: 'guest' } | { type: 'user'; userId: string },
): string {
  return scope.type === 'guest' ? 'search-recents:guest' : `search-recents:user:${scope.userId}`;
}

const LIKE_ESCAPE_SQL = "ESCAPE '\\'";

/** Local writes use `T`; PowerSync uses a space. Normalize before text DESC. */
export function searchCreatedAtOrderSql(column: string): string {
  return `replace(${column}, 'T', ' ') DESC`;
}

export function compileGuestSearchSql(
  query: Extract<ParsedSearchQuery, { status: 'ready' }>,
  limit: number,
): CompiledSearchSql {
  const fetchLimit = limit + 1;
  const ranking = rankingSql('title', query);
  const keywords = keywordSql('title', 'description', query);
  return {
    sql: `SELECT id, title, description, priority, scheduled_date AS scheduledDate,
  scheduled_time AS scheduledTime, completed_at AS completedAt, created_at AS createdAt
         FROM local_tasks
         WHERE completed_at IS NULL AND ${keywords.sql}
         ORDER BY ${ranking.sql}, created_at DESC, id DESC
         LIMIT ?`,
    parameters: [...keywords.parameters, ...ranking.parameters, String(fetchLimit)],
    fetchLimit,
  };
}

export function compileAccountSearchSql(
  query: Extract<ParsedSearchQuery, { status: 'ready' }>,
  userId: string,
  limit: number,
): CompiledSearchSql {
  const fetchLimit = limit + 1;
  const ranking = rankingSql('t.title', query);
  const keywords = keywordSql('t.title', 't.description', query);
  return {
    sql: `WITH matched AS (
         SELECT t.id, t.title, t.description, t.priority,
           t.scheduled_date AS scheduledDate, t.scheduled_time AS scheduledTime,
           t.completed_at AS completedAt, t.created_at AS createdAt,
           t.project_id AS projectId,
           ${ranking.select} AS searchRank
         FROM tasks t
         WHERE t.user_id = ? AND t.completed_at IS NULL AND ${keywords.sql}
         ORDER BY searchRank ASC, ${searchCreatedAtOrderSql('t.created_at')}, t.id DESC
         LIMIT ?
       )
       SELECT m.id, m.title, m.description, m.priority,
         m.scheduledDate, m.scheduledTime, m.completedAt, m.createdAt,
         m.projectId, m.searchRank,
         p.id AS projectSummaryId, p.name AS projectName, p.color AS projectColor,
         p.is_archived AS projectIsArchived,
         l.id AS labelId, l.name AS labelName, l.color AS labelColor
       FROM matched m
       LEFT JOIN projects p ON p.id = m.projectId AND p.user_id = ?
       LEFT JOIN task_labels tl ON tl.task_id = m.id AND tl.user_id = ?
       LEFT JOIN labels l ON l.id = tl.label_id AND l.user_id = ?
       ORDER BY m.searchRank ASC, ${searchCreatedAtOrderSql('m.createdAt')}, m.id DESC, lower(l.name) ASC, l.id ASC`,
    parameters: [
      ...ranking.parameters,
      userId,
      ...keywords.parameters,
      String(fetchLimit),
      userId,
      userId,
      userId,
    ],
    fetchLimit,
  };
}

function rankingSql(
  titleColumn: string,
  query: Extract<ParsedSearchQuery, { status: 'ready' }>,
): { sql: string; select: string; parameters: string[] } {
  const titleMatch = query.words
    .map(() => `COALESCE(${titleColumn}, '') LIKE ? ${LIKE_ESCAPE_SQL}`)
    .join(' AND ');
  const select = `CASE
      WHEN COALESCE(${titleColumn}, '') LIKE ? ${LIKE_ESCAPE_SQL} THEN 0
      WHEN COALESCE(${titleColumn}, '') LIKE ? ${LIKE_ESCAPE_SQL} THEN 1
      WHEN (${titleMatch}) THEN 2
      ELSE 3
    END`;
  return {
    sql: `${select} ASC`,
    select,
    parameters: [
      escapeLikeLiteral(query.normalized),
      prefixLikePattern(query.normalized),
      ...query.words.map((word) => containsLikePattern(word)),
    ],
  };
}

function keywordSql(
  titleColumn: string,
  descriptionColumn: string,
  query: Extract<ParsedSearchQuery, { status: 'ready' }>,
): { sql: string; parameters: string[] } {
  const clauses = query.words.map(
    () =>
      `(COALESCE(${titleColumn}, '') LIKE ? ${LIKE_ESCAPE_SQL} OR COALESCE(${descriptionColumn}, '') LIKE ? ${LIKE_ESCAPE_SQL})`,
  );
  const parameters = query.words.flatMap((word) => {
    const pattern = containsLikePattern(word);
    return [pattern, pattern];
  });
  return { sql: clauses.join(' AND '), parameters };
}
