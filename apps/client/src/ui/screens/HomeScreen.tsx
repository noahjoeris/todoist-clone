import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  type SyncStatusSource,
  type Task,
  type TaskInput,
  type TaskRepository,
  TaskRestoreConflictError,
} from '../../data/repositories';
import { ActionButton } from '../components/ActionButton';
import { TaskComposer } from '../components/TaskComposer';
import { TaskEditor } from '../components/TaskEditor';
import { TaskList } from '../components/TaskList';
import { TaskRow } from '../components/TaskRow';
import { UndoBanner } from '../components/UndoBanner';
import { useSyncStatus } from '../hooks/useSyncStatus';
import { partitionTasks } from '../partition-tasks';
import { createTaskUndoController } from '../task-undo';
import { colors } from '../theme';

/** How the guest screen offers (or explains the absence of) account sign-in. */
export type AccountEntry =
  | { kind: 'hidden' }
  | { kind: 'sign-in'; onPress: () => void }
  | { kind: 'unavailable'; message: string }
  | { kind: 'account'; label: string; onPress: () => void };

interface HomeScreenProps {
  repository: TaskRepository;
  account: AccountEntry;
  sync?: SyncStatusSource;
}

const SYNC_LABEL: Record<NonNullable<ReturnType<typeof useSyncStatus>>, string> = {
  offline: 'Offline',
  syncing: 'Syncing',
  synced: 'Synced',
};

export function HomeScreen({ repository, account, sync }: HomeScreenProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [composing, setComposing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
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

  useEffect(() => () => undo.dismiss(), [undo]);

  useEffect(() => {
    // Retry subscribes afresh, including a fresh read of the local database.
    void retry;
    setLoading(true);
    setError(false);
    return repository.subscribe(
      (nextTasks) => {
        setTasks(nextTasks);
        setLoading(false);
        setError(false);
      },
      () => {
        setError(true);
        setLoading(false);
      },
    );
  }, [repository, retry]);

  const { active, completed } = partitionTasks(tasks);
  const editingTask =
    editingId == null ? null : (tasks.find((task) => task.id === editingId) ?? null);
  const editorMissing = editingId != null && editingTask == null;

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

  function openTask(task: Task) {
    setComposing(false);
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

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <TaskList
        active={active}
        completed={completed}
        completedExpanded={completedExpanded}
        onToggleCompleted={() => setCompletedExpanded((open) => !open)}
        renderTask={(task) => (
          <TaskRow
            task={task}
            onOpen={openTask}
            onSetCompletion={(item, completedValue) =>
              void runWrite(
                item.id,
                () => repository.setCompletion(item.id, completedValue),
                'Couldn’t update that task. Try again.',
              )
            }
          />
        )}
        empty={
          loading ? (
            <ActivityIndicator color={colors.muted} style={styles.empty} />
          ) : !error && !composing && editingId == null ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>A little space to get things done.</Text>
              <Text style={styles.emptyText}>Add your first task to get started.</Text>
            </View>
          ) : null
        }
        header={
          <View style={styles.header}>
            <Text style={styles.eyebrow}>TODOIST CLONE</Text>
            <View style={styles.heading}>
              <Text accessibilityRole="header" style={styles.title}>
                My tasks
              </Text>
              {!loading && (
                <Text style={styles.count}>
                  {active.length} {active.length === 1 ? 'task' : 'tasks'}
                </Text>
              )}
              {syncIndicator && (
                <Text accessibilityLiveRegion="polite" style={styles.sync}>
                  {SYNC_LABEL[syncIndicator]}
                </Text>
              )}
              {(account.kind === 'sign-in' || account.kind === 'account') && (
                <View style={styles.account}>
                  <ActionButton
                    label={account.kind === 'sign-in' ? 'Sign in' : account.label}
                    onPress={account.onPress}
                  />
                </View>
              )}
            </View>
            {account.kind === 'unavailable' && (
              <Text accessibilityRole="alert" style={styles.authUnavailable}>
                Sign-in is unavailable. {account.message}
              </Text>
            )}
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
                onSave={saveEdit}
                onDelete={deleteEditing}
                onClose={() => setEditingId(null)}
              />
            ) : composing ? (
              <TaskComposer onCreate={repository.create} onClose={() => setComposing(false)} />
            ) : (
              <View style={styles.add}>
                <ActionButton
                  label="+ Add task"
                  color={colors.accent}
                  onPress={() => setComposing(true)}
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
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { gap: 24, marginBottom: 16 },
  eyebrow: { color: colors.muted, fontSize: 11, fontWeight: '600', letterSpacing: 2 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { color: colors.text, fontSize: 28, fontWeight: '700' },
  count: { color: colors.muted, fontSize: 13 },
  sync: { color: colors.muted, fontSize: 13 },
  account: { marginLeft: 'auto' },
  authUnavailable: { color: colors.error, fontSize: 13, lineHeight: 18 },
  add: { alignSelf: 'flex-start' },
  empty: { paddingVertical: 64, alignItems: 'center', gap: 10 },
  emptyTitle: { color: colors.text, fontSize: 17, textAlign: 'center' },
  emptyText: { color: colors.muted, fontSize: 14, textAlign: 'center' },
  failure: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  error: { color: colors.error, fontSize: 14, flex: 1 },
});
