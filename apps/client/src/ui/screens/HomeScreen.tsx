import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  type SyncStatusSource,
  type Task,
  type TaskActiveCounts,
  type TaskDestination,
  type TaskInput,
  type TaskRepository,
  TaskRestoreConflictError,
  type TaskViewQuery,
} from '../../data/repositories';
import type { AccountEntry } from '../account-entry';
import { ActionButton } from '../components/ActionButton';
import { AppShell } from '../components/AppShell';
import { Sidebar } from '../components/Sidebar';
import { TaskComposer } from '../components/TaskComposer';
import { TaskEditor } from '../components/TaskEditor';
import { TaskList, type TaskSection } from '../components/TaskList';
import { TaskRow } from '../components/TaskRow';
import { dateLabel, upcomingBounds } from '../components/task-date';
import { UndoBanner } from '../components/UndoBanner';
import { confirmDiscard } from '../discard-draft';
import {
  closedDrawer,
  finishDrawerClose,
  layoutModeForWidth,
  releaseDrawerHost,
  requestDrawerClose,
  requestDrawerOpen,
} from '../drawer-presence';
import { useCalendarToday } from '../hooks/useCalendarToday';
import { useSyncStatus } from '../hooks/useSyncStatus';
import { createTaskUndoController } from '../task-undo';
import { groupTasksByScheduledDate, rescheduleInput, splitTodayGroups } from '../task-view-groups';
import { colors } from '../theme';

export type { AccountEntry };

type Composer =
  | { kind: 'closed' }
  | { kind: 'global' }
  | { kind: 'view' }
  | { kind: 'group'; date: string };

interface HomeScreenProps {
  repository: TaskRepository;
  account: AccountEntry;
  destination: TaskDestination;
  onDestinationChange: (destination: TaskDestination) => void;
  upcomingDays: number;
  onLoadMoreUpcoming: () => void;
  banner?: ReactNode;
  sync?: SyncStatusSource;
}

const SYNC_LABEL: Record<NonNullable<ReturnType<typeof useSyncStatus>>, string> = {
  offline: 'Offline',
  syncing: 'Syncing',
  synced: 'Synced',
};

const EMPTY_COPY: Record<TaskDestination, { title: string; text: string }> = {
  inbox: {
    title: 'A little space to get things done.',
    text: 'Add your first task to get started.',
  },
  today: {
    title: 'All clear for today.',
    text: 'Overdue and dated tasks show up here. Unscheduled tasks stay in Inbox.',
  },
  upcoming: {
    title: 'Nothing upcoming in this range.',
    text: 'Tasks scheduled after today appear here. Load more to look further ahead.',
  },
};

export function HomeScreen({
  repository,
  account,
  destination,
  onDestinationChange,
  upcomingDays,
  onLoadMoreUpcoming,
  banner,
  sync,
}: HomeScreenProps) {
  const today = useCalendarToday();
  const { width } = useWindowDimensions();
  const layoutMode = layoutModeForWidth(width);
  const [presence, setPresence] = useState(closedDrawer);
  const layoutModeRef = useRef(layoutMode);
  const menuButtonRef = useRef<View>(null);
  const dirtyCheckRef = useRef<() => boolean>(() => false);

  const [active, setActive] = useState<Task[]>([]);
  const [completed, setCompleted] = useState<Task[]>([]);
  const [counts, setCounts] = useState<TaskActiveCounts>({ inbox: 0, today: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [composer, setComposer] = useState<Composer>({ kind: 'closed' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);
  const [completedExpanded, setCompletedExpanded] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [undoPending, setUndoPending] = useState(false);
  const pendingIds = useRef(new Set<string>());
  const syncIndicator = useSyncStatus(sync);
  const undo = useMemo(
    () => createTaskUndoController({ restore: (task) => repository.restore(task) }),
    [repository],
  );
  const undoState = useSyncExternalStore(undo.subscribe, undo.getState, undo.getState);
  const upcoming = useMemo(() => upcomingBounds(today, upcomingDays), [today, upcomingDays]);

  const activeQuery = useMemo(
    () => viewQuery(destination, today, upcoming, 'active'),
    [destination, today, upcoming],
  );
  const completedQuery = useMemo(
    () => viewQuery(destination, today, upcoming, 'completed'),
    [destination, today, upcoming],
  );

  useEffect(() => () => undo.dismiss(), [undo]);

  useEffect(() => {
    if (layoutModeRef.current === layoutMode) return;
    layoutModeRef.current = layoutMode;
    setPresence((state) => releaseDrawerHost(state));
  }, [layoutMode]);

  useEffect(() => {
    void retry;
    setLoading(true);
    setError(false);
    let activeReady = false;
    let completedReady = false;
    let failed = false;

    function markReady() {
      if (!failed && activeReady && completedReady) setLoading(false);
    }

    const stopActive = repository.subscribeView(
      activeQuery,
      (tasks) => {
        setActive(tasks);
        activeReady = true;
        setError(false);
        markReady();
      },
      () => {
        failed = true;
        setError(true);
        setLoading(false);
      },
    );
    const stopCompleted = repository.subscribeView(
      completedQuery,
      (tasks) => {
        setCompleted(tasks);
        completedReady = true;
        setError(false);
        markReady();
      },
      () => {
        failed = true;
        setError(true);
        setLoading(false);
      },
    );
    return () => {
      stopActive();
      stopCompleted();
    };
  }, [repository, retry, activeQuery, completedQuery]);

  useEffect(() => {
    return repository.subscribeActiveCounts(today, setCounts, () => {});
  }, [repository, today]);

  const registerDirtyCheck = useCallback((isDirty: () => boolean) => {
    dirtyCheckRef.current = isDirty;
    return () => {
      dirtyCheckRef.current = () => false;
    };
  }, []);

  const onCloseDrawer = useCallback(() => {
    setPresence(requestDrawerClose);
  }, []);

  const onCloseFinished = useCallback((generation: number) => {
    setPresence((state) => finishDrawerClose(state, generation));
  }, []);

  function closeForms() {
    setComposer({ kind: 'closed' });
    setEditingId(null);
    setReschedulingId(null);
  }

  async function confirmLeave() {
    if (dirtyCheckRef.current()) {
      const discard = await confirmDiscard();
      if (!discard) return false;
    }
    closeForms();
    return true;
  }

  async function runWrite(id: string, action: () => Promise<void>, failedMessage: string) {
    if (pendingIds.current.has(id)) return;
    pendingIds.current.add(id);
    setActionError(null);
    try {
      await action();
    } catch {
      setActionError(failedMessage);
    } finally {
      pendingIds.current.delete(id);
    }
  }

  async function openTask(task: Task) {
    if (!(await confirmLeave())) return;
    setEditingId(task.id);
  }

  async function saveEdit(input: TaskInput) {
    if (editingId == null) return;
    await repository.update(editingId, input);
  }

  async function deleteEditing() {
    if (editingId == null) return;
    const snapshot = await repository.delete(editingId);
    setUndoError(null);
    undo.offer(snapshot);
  }

  async function undoDelete() {
    if (undoPending) return;
    setUndoPending(true);
    setUndoError(null);
    try {
      await undo.undo();
    } catch (cause) {
      setUndoError(
        cause instanceof TaskRestoreConflictError
          ? 'Couldn’t restore that task; something else is using its place.'
          : 'Couldn’t restore that task. Try again.',
      );
    } finally {
      setUndoPending(false);
    }
  }

  async function selectDestination(next: TaskDestination) {
    if (next !== destination) {
      if (!(await confirmLeave())) return;
      onDestinationChange(next);
    }
    setPresence(requestDrawerClose);
  }

  async function addFromSidebar() {
    if (!(await confirmLeave())) return;
    setComposer({ kind: 'global' });
    setPresence(requestDrawerClose);
  }

  async function addFromView() {
    if (!(await confirmLeave())) return;
    setComposer({ kind: 'view' });
  }

  async function addFromGroup(date: string) {
    if (!(await confirmLeave())) return;
    setComposer({ kind: 'group', date });
  }

  const wrappedAccount = wrapAccount(account, confirmLeave);
  const editingTask =
    editingId == null
      ? null
      : (active.find((task) => task.id === editingId) ??
        completed.find((task) => task.id === editingId) ??
        null);
  const editorMissing = editingId != null && editingTask == null;
  const composerDate = defaultComposerDate(composer, destination, today);
  const sections = buildSections(destination, active, today, addFromGroup);
  const emptyCopy = EMPTY_COPY[destination];
  const composing = composer.kind !== 'closed';

  const sidebar = (
    <Sidebar
      account={wrappedAccount}
      destination={destination}
      counts={counts}
      syncLabel={syncIndicator ? SYNC_LABEL[syncIndicator] : undefined}
      onSelect={(next) => void selectDestination(next)}
      onAddTask={() => void addFromSidebar()}
    />
  );

  return (
    <SafeAreaView style={styles.safe}>
      {banner}
      <AppShell
        layoutMode={layoutMode}
        presence={presence}
        sidebar={sidebar}
        onCloseDrawer={onCloseDrawer}
        onCloseFinished={onCloseFinished}
        menuButtonRef={menuButtonRef}
      >
        <KeyboardAvoidingView
          style={styles.screen}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TaskList
            sections={sections}
            completed={completed}
            completedExpanded={completedExpanded}
            onToggleCompleted={() => setCompletedExpanded((open) => !open)}
            {...(destination === 'upcoming'
              ? { loadMore: { label: 'Load more', onPress: onLoadMoreUpcoming } }
              : {})}
            renderTask={(task) => (
              <TaskRow
                task={task}
                today={today}
                onOpen={(item) => void openTask(item)}
                onSetCompletion={(item, completedValue) =>
                  void runWrite(
                    item.id,
                    () => repository.setCompletion(item.id, completedValue),
                    'Couldn’t update that task. Try again.',
                  )
                }
                rescheduleOpen={reschedulingId === task.id}
                onRescheduleOpen={() => setReschedulingId(task.id)}
                onRescheduleClose={() => setReschedulingId(null)}
                onReschedule={(date) =>
                  void runWrite(
                    task.id,
                    () => repository.update(task.id, rescheduleInput(task, date)),
                    'Couldn’t update that task. Try again.',
                  ).then(() => setReschedulingId(null))
                }
              />
            )}
            empty={
              loading ? (
                <ActivityIndicator color={colors.muted} style={styles.empty} />
              ) : !error && !composing && editingId == null ? (
                <View style={styles.empty}>
                  <Text style={styles.emptyTitle}>{emptyCopy.title}</Text>
                  <Text style={styles.emptyText}>{emptyCopy.text}</Text>
                </View>
              ) : null
            }
            header={
              <View style={styles.header}>
                <View style={styles.heading}>
                  {layoutMode === 'overlay' && (
                    <Pressable
                      ref={menuButtonRef}
                      accessibilityRole="button"
                      accessibilityLabel="Open navigation"
                      onPress={() => setPresence(requestDrawerOpen)}
                      style={({ pressed }) => [styles.menuButton, pressed && styles.pressed]}
                    >
                      <Text style={styles.menuIcon}>☰</Text>
                    </Pressable>
                  )}
                  <Text accessibilityRole="header" style={styles.title}>
                    {destination === 'inbox'
                      ? 'Inbox'
                      : destination === 'today'
                        ? 'Today'
                        : 'Upcoming'}
                  </Text>
                  {!loading && (
                    <Text style={styles.count}>
                      {active.length} {active.length === 1 ? 'task' : 'tasks'}
                    </Text>
                  )}
                </View>
                {undoState && (
                  <UndoBanner
                    message={`Deleted “${undoState.task.title}”.`}
                    pending={undoPending}
                    error={undoError}
                    onUndo={() => void undoDelete()}
                  />
                )}
                {editingId ? (
                  <TaskEditor
                    key={editingId}
                    task={editingTask}
                    missing={editorMissing}
                    today={today}
                    registerDirtyCheck={registerDirtyCheck}
                    onSave={saveEdit}
                    onDelete={deleteEditing}
                    onClose={() => setEditingId(null)}
                  />
                ) : composing ? (
                  <TaskComposer
                    key={`${composer.kind}:${composerDate ?? 'none'}`}
                    initialDate={composerDate}
                    today={today}
                    registerDirtyCheck={registerDirtyCheck}
                    onCreate={repository.create}
                    onClose={() => setComposer({ kind: 'closed' })}
                  />
                ) : (
                  <View style={styles.add}>
                    <ActionButton
                      label="+ Add task"
                      color={colors.accent}
                      onPress={() => void addFromView()}
                    />
                  </View>
                )}
                {actionError && (
                  <Text accessibilityRole="alert" style={styles.error}>
                    {actionError}
                  </Text>
                )}
                {error && (
                  <View style={styles.failure}>
                    <Text accessibilityRole="alert" style={styles.error}>
                      Couldn’t load your tasks.
                    </Text>
                    <ActionButton label="Retry" onPress={() => setRetry((value) => value + 1)} />
                  </View>
                )}
              </View>
            }
          />
        </KeyboardAvoidingView>
      </AppShell>
    </SafeAreaView>
  );
}

function viewQuery(
  destination: TaskDestination,
  today: string,
  upcoming: { startInclusive: string; endExclusive: string },
  completion: 'active' | 'completed',
): TaskViewQuery {
  if (destination === 'inbox') return { destination: 'inbox', completion };
  if (destination === 'today') return { destination: 'today', today, completion };
  return {
    destination: 'upcoming',
    startInclusive: upcoming.startInclusive,
    endExclusive: upcoming.endExclusive,
    completion,
  };
}

function defaultComposerDate(
  composer: Composer,
  destination: TaskDestination,
  today: string,
): string | null {
  if (composer.kind === 'global' || composer.kind === 'closed') return null;
  if (composer.kind === 'group') return composer.date;
  if (destination === 'today') return today;
  return null;
}

function buildSections(
  destination: TaskDestination,
  active: Task[],
  today: string,
  onAddGroup: (date: string) => void,
): TaskSection[] {
  const now = new Date(`${today}T12:00:00`);
  if (destination === 'inbox') return [{ key: 'inbox', tasks: active }];
  if (destination === 'today') {
    const { overdue, dueToday } = splitTodayGroups(active, today);
    const sections: TaskSection[] = [];
    if (overdue.length > 0) sections.push({ key: 'overdue', title: 'Overdue', tasks: overdue });
    if (dueToday.length > 0) sections.push({ key: 'today', title: 'Today', tasks: dueToday });
    return sections;
  }
  return groupTasksByScheduledDate(active).map((group) => ({
    key: group.date,
    title: dateLabel(group.date, now),
    tasks: group.tasks,
    onAdd: () => onAddGroup(group.date),
  }));
}

function wrapAccount(account: AccountEntry, confirmLeave: () => Promise<boolean>): AccountEntry {
  if (account.kind !== 'sign-in' && account.kind !== 'account') return account;
  return {
    ...account,
    onPress: () => {
      void confirmLeave().then((ok) => {
        if (ok) account.onPress();
      });
    },
  };
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  screen: { flex: 1, backgroundColor: colors.background },
  header: { gap: 24, marginBottom: 16 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  menuButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuIcon: { color: colors.text, fontSize: 22 },
  pressed: { opacity: 0.7 },
  title: { color: colors.text, fontSize: 28, fontWeight: '700' },
  count: { color: colors.muted, fontSize: 13 },
  add: { alignSelf: 'flex-start' },
  empty: { paddingVertical: 64, alignItems: 'center', gap: 10 },
  emptyTitle: { color: colors.text, fontSize: 17, textAlign: 'center' },
  emptyText: { color: colors.muted, fontSize: 14, textAlign: 'center' },
  failure: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  error: { color: colors.error, fontSize: 14, flex: 1 },
});
