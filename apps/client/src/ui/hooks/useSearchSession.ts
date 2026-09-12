import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  parseSearchQuery,
  type RecentSearchRepository,
  SEARCH_PAGE_SIZE,
  type TaskRepository,
  type TaskSearchSnapshot,
} from '../../data/repositories';
import {
  createQueryDebouncer,
  EMPTY_SEARCH_SNAPSHOT,
  runRecentSearchMutation,
  type SearchResultsStatus,
  visibleSearchResults,
} from '../search-session';

export function useSearchSession(
  tasks: TaskRepository,
  recents: RecentSearchRepository,
  open: boolean,
) {
  const [input, setInputState] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [limit, setLimit] = useState(SEARCH_PAGE_SIZE);
  const [snapshot, setSnapshot] = useState<TaskSearchSnapshot>(EMPTY_SEARCH_SNAPSHOT);
  const [snapshotQuery, setSnapshotQuery] = useState('');
  const [status, setStatus] = useState<SearchResultsStatus>('idle');
  const [searchRetry, setSearchRetry] = useState(0);
  const [recentQueries, setRecentQueries] = useState<string[]>([]);
  const [recentsError, setRecentsError] = useState(false);
  const [recentsWriteError, setRecentsWriteError] = useState(false);
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
    setSnapshot(EMPTY_SEARCH_SNAPSHOT);
    setSnapshotQuery('');
    setStatus('idle');
    setRecentQueries([]);
    setRecentsError(false);
    setRecentsWriteError(false);
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
      setSnapshot(EMPTY_SEARCH_SNAPSHOT);
      setSnapshotQuery(activeQuery);
      setStatus('idle');
      return;
    }
    const generation = ++searchGeneration.current;
    const subscribedQuery = activeQuery;
    const replacing = lastSearchQuery.current !== subscribedQuery;
    lastSearchQuery.current = subscribedQuery;
    if (replacing) {
      setSnapshot(EMPTY_SEARCH_SNAPSHOT);
      setStatus('loading');
    } else {
      setStatus('updating');
    }
    const stop = tasks.subscribeSearch(
      { query: subscribedQuery, limit },
      (next) => {
        if (generation !== searchGeneration.current || !openRef.current) return;
        setSnapshot(next);
        setSnapshotQuery(subscribedQuery);
        setStatus('ready');
      },
      () => {
        if (generation !== searchGeneration.current || !openRef.current) return;
        setSnapshotQuery(subscribedQuery);
        setStatus('error');
      },
    );
    return () => stop();
  }, [tasks, activeQuery, limit, open, searchRetry]);

  const visible = visibleSearchResults({
    input,
    activeQuery,
    snapshotQuery,
    snapshot,
    status,
  });

  const mutateRecents = useCallback((action: () => Promise<void>) => {
    return runRecentSearchMutation(
      action,
      () => {
        if (openRef.current) setRecentsWriteError(true);
      },
      () => {
        if (openRef.current) setRecentsWriteError(false);
      },
    );
  }, []);

  const setInput = useCallback(
    (value: string) => {
      setInputState(value);
      debouncer.set(value);
    },
    [debouncer],
  );

  const submit = useCallback(() => {
    debouncer.flush(input);
    void mutateRecents(() => recents.record(input));
  }, [debouncer, input, recents, mutateRecents]);

  const applyRecent = useCallback(
    (query: string) => {
      setInputState(query);
      debouncer.flush(query);
      void mutateRecents(() => recents.record(query));
    },
    [debouncer, recents, mutateRecents],
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

  const recordCurrent = useCallback(
    () => mutateRecents(() => recents.record(input)),
    [mutateRecents, recents, input],
  );

  const removeRecent = useCallback(
    (query: string) => mutateRecents(() => recents.remove(query)),
    [mutateRecents, recents],
  );

  const clearRecents = useCallback(
    () => mutateRecents(() => recents.clear()),
    [mutateRecents, recents],
  );

  return {
    input,
    setInput,
    submit,
    applyRecent,
    recents: recentQueries,
    recentsError,
    recentsWriteError,
    retryRecents,
    tasks: visible.snapshot.tasks,
    hasMore: visible.snapshot.hasMore,
    status: visible.status,
    retrySearch,
    loadMore,
    recordCurrent,
    removeRecent,
    clearRecents,
    queryPending: visible.queryPending,
  };
}
