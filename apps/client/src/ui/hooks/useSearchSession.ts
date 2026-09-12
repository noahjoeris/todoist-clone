import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  parseSearchQuery,
  type RecentSearchRepository,
  SEARCH_PAGE_SIZE,
  type TaskRepository,
  type TaskSearchSnapshot,
} from '../../data/repositories';
import { createQueryDebouncer, type SearchResultsStatus } from '../search-session';

const EMPTY_SNAPSHOT: TaskSearchSnapshot = { tasks: [], hasMore: false };

export function useSearchSession(
  tasks: TaskRepository,
  recents: RecentSearchRepository,
  open: boolean,
) {
  const [input, setInputState] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [limit, setLimit] = useState(SEARCH_PAGE_SIZE);
  const [snapshot, setSnapshot] = useState<TaskSearchSnapshot>(EMPTY_SNAPSHOT);
  const [status, setStatus] = useState<SearchResultsStatus>('idle');
  const [searchRetry, setSearchRetry] = useState(0);
  const [recentQueries, setRecentQueries] = useState<string[]>([]);
  const [recentsError, setRecentsError] = useState(false);
  const [recentsRetry, setRecentsRetry] = useState(0);
  const searchGeneration = useRef(0);
  const recentsGeneration = useRef(0);
  const lastSearchQuery = useRef('');
  const openRef = useRef(open);
  openRef.current = open;

  const debouncer = useMemo(
    () =>
      createQueryDebouncer({
        onFlush: (query) => {
          setActiveQuery(query);
          setLimit(SEARCH_PAGE_SIZE);
        },
      }),
    [],
  );

  useEffect(() => () => debouncer.dispose(), [debouncer]);

  useEffect(() => {
    if (open) return;
    debouncer.dispose();
    searchGeneration.current += 1;
    recentsGeneration.current += 1;
    setInputState('');
    setActiveQuery('');
    setLimit(SEARCH_PAGE_SIZE);
    setSnapshot(EMPTY_SNAPSHOT);
    setStatus('idle');
    setRecentQueries([]);
    setRecentsError(false);
    lastSearchQuery.current = '';
  }, [open, debouncer]);

  useEffect(() => {
    if (!open) return;
    void recentsRetry;
    const generation = ++recentsGeneration.current;
    return recents.subscribe(
      (queries) => {
        if (generation !== recentsGeneration.current || !openRef.current) return;
        setRecentQueries(queries);
        setRecentsError(false);
      },
      () => {
        if (generation !== recentsGeneration.current || !openRef.current) return;
        setRecentsError(true);
      },
    );
  }, [recents, open, recentsRetry]);

  useEffect(() => {
    if (!open) return;
    void searchRetry;
    const parsed = parseSearchQuery(activeQuery);
    if (parsed.status !== 'ready') {
      searchGeneration.current += 1;
      lastSearchQuery.current = activeQuery;
      setSnapshot(EMPTY_SNAPSHOT);
      setStatus('idle');
      return;
    }
    const generation = ++searchGeneration.current;
    const replacing = lastSearchQuery.current !== activeQuery;
    lastSearchQuery.current = activeQuery;
    if (replacing) {
      setSnapshot(EMPTY_SNAPSHOT);
      setStatus('loading');
    } else {
      setStatus('updating');
    }
    const stop = tasks.subscribeSearch(
      { query: activeQuery, limit },
      (next) => {
        if (generation !== searchGeneration.current || !openRef.current) return;
        setSnapshot(next);
        setStatus('ready');
      },
      () => {
        if (generation !== searchGeneration.current || !openRef.current) return;
        setStatus('error');
      },
    );
    return () => stop();
  }, [tasks, activeQuery, limit, open, searchRetry]);

  const parsedInput = parseSearchQuery(input);
  const queryPending = parsedInput.status === 'ready' && input !== activeQuery;
  const visibleSnapshot = queryPending ? EMPTY_SNAPSHOT : snapshot;
  const visibleStatus: SearchResultsStatus = queryPending
    ? 'loading'
    : parsedInput.status === 'invalid'
      ? 'error'
      : status;

  const setInput = useCallback(
    (value: string) => {
      setInputState(value);
      debouncer.set(value);
    },
    [debouncer],
  );

  const submit = useCallback(() => {
    debouncer.flush(input);
    void recents.record(input);
  }, [debouncer, input, recents]);

  const applyRecent = useCallback(
    (query: string) => {
      setInputState(query);
      debouncer.flush(query);
      void recents.record(query);
    },
    [debouncer, recents],
  );

  const loadMore = useCallback(() => {
    setLimit((current) => current + SEARCH_PAGE_SIZE);
  }, []);

  const retrySearch = useCallback(() => {
    setSearchRetry((current) => current + 1);
  }, []);

  const retryRecents = useCallback(() => {
    setRecentsRetry((current) => current + 1);
  }, []);

  const recordCurrent = useCallback(() => recents.record(input), [recents, input]);

  const removeRecent = useCallback((query: string) => recents.remove(query), [recents]);

  const clearRecents = useCallback(() => recents.clear(), [recents]);

  return {
    input,
    setInput,
    submit,
    applyRecent,
    recents: recentQueries,
    recentsError,
    retryRecents,
    tasks: visibleSnapshot.tasks,
    hasMore: visibleSnapshot.hasMore,
    status: visibleStatus,
    retrySearch,
    loadMore,
    recordCurrent,
    removeRecent,
    clearRecents,
    queryPending,
  };
}
