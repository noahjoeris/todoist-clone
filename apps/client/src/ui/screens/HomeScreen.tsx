import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { SyncStatusSource, Task, TaskRepository } from '../../data/repositories';
import { ActionButton } from '../components/ActionButton';
import { TaskComposer } from '../components/TaskComposer';
import { TaskRow } from '../components/TaskRow';
import { useSyncStatus } from '../hooks/useSyncStatus';
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
  const syncIndicator = useSyncStatus(sync);

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

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <FlatList
        data={tasks}
        keyExtractor={(task) => task.id}
        renderItem={({ item }) => <TaskRow task={item} />}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.eyebrow}>TODOIST CLONE</Text>
            <View style={styles.heading}>
              <Text accessibilityRole="header" style={styles.title}>
                My tasks
              </Text>
              {!loading && (
                <Text style={styles.count}>
                  {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}
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
            {composing ? (
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
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.muted} style={styles.empty} />
          ) : !error && !composing ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>A little space to get things done.</Text>
              <Text style={styles.emptyText}>Add your first task to get started.</Text>
            </View>
          ) : null
        }
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: {
    width: '100%',
    maxWidth: 840,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 72,
    paddingBottom: 64,
  },
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
