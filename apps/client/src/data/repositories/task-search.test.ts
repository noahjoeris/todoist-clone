import { describe, expect, it } from 'vitest';
import {
  compileAccountSearchSql,
  compileGuestSearchSql,
  containsLikePattern,
  escapeLikeLiteral,
  MAX_RECENT_SEARCHES,
  MAX_SEARCH_QUERY_LENGTH,
  normalizeSearchQuery,
  parseSearchQuery,
  parseStoredRecentSearches,
  prefixLikePattern,
  recentSearchPreferenceId,
  recordRecentSearch,
  removeRecentSearch,
  searchQueryIdentity,
} from './task-search';

describe('search query parsing', () => {
  it('trims, collapses whitespace, and splits words', () => {
    expect(parseSearchQuery('')).toEqual({ status: 'blank' });
    expect(parseSearchQuery('   \n\t  ')).toEqual({ status: 'blank' });
    expect(parseSearchQuery('  Buy   milk ')).toEqual({
      status: 'ready',
      normalized: 'Buy milk',
      words: ['Buy', 'milk'],
    });
  });

  it('rejects queries longer than 200 characters before searching', () => {
    expect(parseSearchQuery('a'.repeat(MAX_SEARCH_QUERY_LENGTH))).toMatchObject({
      status: 'ready',
    });
    expect(parseSearchQuery('a'.repeat(MAX_SEARCH_QUERY_LENGTH + 1))).toEqual({
      status: 'invalid',
      reason: 'too-long',
    });
  });

  it('treats today, p1, and search: as literal words', () => {
    const parsed = parseSearchQuery('today p1 search:');
    expect(parsed).toMatchObject({
      status: 'ready',
      words: ['today', 'p1', 'search:'],
    });
  });

  it('folds only ASCII letters for recent-query identity', () => {
    expect(searchQueryIdentity('Buy Milk')).toBe('buy milk');
    expect(searchQueryIdentity('CAFÉ')).toBe('cafÉ');
    expect(normalizeSearchQuery('  CAFÉ  ')).toBe('CAFÉ');
  });
});

describe('LIKE escaping', () => {
  it('escapes %, _, and the escape character', () => {
    expect(escapeLikeLiteral('100%_done\\x')).toBe('100\\%\\_done\\\\x');
    expect(containsLikePattern('a%b')).toBe('%a\\%b%');
    expect(prefixLikePattern('a_b')).toBe('a\\_b%');
  });

  it('binds escaped patterns instead of interpolating user text', () => {
    const parsed = parseSearchQuery('50% off_ "quote" \\ #&*');
    if (parsed.status !== 'ready') throw new Error('expected ready');
    const guest = compileGuestSearchSql(parsed, 50);
    expect(guest.sql).not.toContain('50% off');
    expect(guest.sql).toContain("ESCAPE '\\'");
    expect(guest.sql).toContain('LIMIT ?');
    expect(guest.parameters[0]).toBe(containsLikePattern('50%'));
    expect(guest.parameters).toContain(containsLikePattern('50%'));
    expect(guest.parameters).toContain(containsLikePattern('off_'));
    expect(guest.parameters.some((value) => value.includes('%'))).toBe(true);

    const account = compileAccountSearchSql(parsed, 'user-1', 50);
    expect(account.sql).toMatch(/WITH matched AS/);
    expect(account.sql).toContain('t.user_id = ?');
    expect(account.sql).toContain('t.completed_at IS NULL');
    expect(account.parameters[account.parameters.length - 3]).toBe('user-1');
  });
});

describe('recent search identity', () => {
  it('deduplicates with ASCII folding and keeps latest casing, capped at five', () => {
    let recents: string[] = [];
    for (const query of ['one', 'two', 'three', 'four', 'five', 'six']) {
      recents = recordRecentSearch(recents, query) ?? recents;
    }
    expect(recents).toEqual(['six', 'five', 'four', 'three', 'two']);
    expect(recents).toHaveLength(MAX_RECENT_SEARCHES);

    recents = recordRecentSearch(recents, '  FIVE  ') ?? recents;
    expect(recents[0]).toBe('FIVE');
    expect(recents.filter((item) => searchQueryIdentity(item) === 'five')).toHaveLength(1);
  });

  it('ignores blank and overlong record attempts', () => {
    expect(recordRecentSearch(['keep'], '  ')).toBeNull();
    expect(recordRecentSearch(['keep'], 'x'.repeat(MAX_SEARCH_QUERY_LENGTH + 1))).toBeNull();
  });

  it('removes by identity and recovers from malformed stored values', () => {
    const current = ['Buy milk', 'Eggs'];
    expect(removeRecentSearch(current, '  buy MILK ')).toEqual(['Eggs']);
    expect(parseStoredRecentSearches(undefined)).toEqual([]);
    expect(parseStoredRecentSearches('not-json')).toEqual([]);
    expect(parseStoredRecentSearches('{"x":1}')).toEqual([]);
    expect(parseStoredRecentSearches('["ok", 1, "", "  ok  ", "second"]')).toEqual([
      'ok',
      'second',
    ]);
    expect(parseStoredRecentSearches(JSON.stringify(['a', 'b', 'c', 'd', 'e', 'f']))).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ]);
  });

  it('namespaces preference ids by identity, not email', () => {
    expect(recentSearchPreferenceId({ type: 'guest' })).toBe('search-recents:guest');
    expect(recentSearchPreferenceId({ type: 'user', userId: 'user-1' })).toBe(
      'search-recents:user:user-1',
    );
  });
});
