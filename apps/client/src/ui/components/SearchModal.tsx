import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MAX_SEARCH_QUERY_LENGTH, parseSearchQuery, type Task } from '../../data/repositories';
import type { useSearchSession } from '../hooks/useSearchSession';
import { nextSearchSelection, splitSearchSections } from '../search-session';
import { colors } from '../theme';
import { ActionButton } from './ActionButton';
import { LabelChipRow } from './LabelChip';

type SearchSession = ReturnType<typeof useSearchSession>;

interface SearchModalProps {
  session: SearchSession;
  onClose: () => void;
  onOpenTask: (task: Task) => void;
  restoreFocus: () => void;
}

export function SearchModal({ session, onClose, onOpenTask, restoreFocus }: SearchModalProps) {
  const inputRef = useRef<TextInput>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const blank = parseSearchQuery(session.input).status === 'blank';
  const { top, rest } = splitSearchSections(session.tasks);
  const canActivate = !session.queryPending && session.status !== 'loading';
  const tasksRef = useRef(session.tasks);
  tasksRef.current = session.tasks;
  const selectedRef = useRef(selectedIndex);
  selectedRef.current = selectedIndex;
  const canActivateRef = useRef(canActivate);
  canActivateRef.current = canActivate;

  const activate = useCallback(
    (task: Task) => {
      if (!canActivateRef.current) return;
      void session.recordCurrent();
      onOpenTask(task);
      onClose();
    },
    [session, onOpenTask, onClose],
  );

  useEffect(() => {
    return () => restoreFocus();
  }, [restoreFocus]);

  useEffect(() => {
    void session.input;
    void session.queryPending;
    setSelectedIndex(null);
  }, [session.input, session.queryPending]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (tasksRef.current.length === 0 || !canActivateRef.current) return;
        event.preventDefault();
        setSelectedIndex((current) =>
          nextSearchSelection(current, tasksRef.current.length, event.key === 'ArrowDown' ? 1 : -1),
        );
        return;
      }
      if (event.key === 'Enter' && !event.isComposing) {
        const index = selectedRef.current;
        if (index != null && canActivateRef.current) {
          const task = tasksRef.current[index];
          if (task) {
            event.preventDefault();
            activate(task);
          }
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose, activate]);

  const announcement = searchAnnouncement(session, blank);

  return (
    <Modal
      transparent
      animationType="none"
      visible
      onRequestClose={onClose}
      statusBarTranslucent
      accessibilityViewIsModal
    >
      <View style={styles.host} pointerEvents="box-none">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss search"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <KeyboardAvoidingView
          style={styles.sheetWrap}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          pointerEvents="box-none"
        >
          <View accessibilityLabel="Search" style={styles.sheet}>
            <View style={styles.header}>
              <TextInput
                ref={inputRef}
                accessibilityLabel="Search tasks"
                placeholder="Search tasks"
                placeholderTextColor={colors.muted}
                value={session.input}
                onChangeText={session.setInput}
                onSubmitEditing={session.submit}
                autoFocus
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
                maxLength={MAX_SEARCH_QUERY_LENGTH}
                style={styles.input}
              />
              {session.input !== '' && (
                <ActionButton
                  label="Clear"
                  accessibilityLabel="Clear search"
                  onPress={() => session.setInput('')}
                />
              )}
              <ActionButton label="Close" onPress={onClose} />
            </View>
            <Text accessibilityLiveRegion="polite" style={styles.live}>
              {announcement}
            </Text>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
            >
              {blank ? (
                <RecentsPanel session={session} />
              ) : (
                <ResultsPanel
                  session={session}
                  top={top}
                  rest={rest}
                  selectedIndex={selectedIndex}
                  onActivate={activate}
                  onSelect={setSelectedIndex}
                />
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function RecentsPanel({ session }: { session: SearchSession }) {
  return (
    <View style={styles.section}>
      <Text style={styles.hint}>
        Search task names and descriptions. Every word must match, in any order. Punctuation is
        literal.
      </Text>
      {session.recentsError && (
        <View style={styles.failure}>
          <Text accessibilityRole="alert" style={styles.error}>
            Couldn’t load recent searches.
          </Text>
          <ActionButton label="Retry" onPress={session.retryRecents} />
        </View>
      )}
      {session.recents.length > 0 && (
        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.heading}>
            Recent searches
          </Text>
          {session.recents.map((query) => (
            <View key={query} style={styles.recentRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Search ${query}`}
                onPress={() => session.applyRecent(query)}
                style={({ pressed }) => [styles.recentQuery, pressed && styles.pressed]}
              >
                <Text style={styles.recentText}>{query}</Text>
              </Pressable>
              <ActionButton
                label="Remove"
                accessibilityLabel={`Remove ${query} from recent searches`}
                onPress={() => void session.removeRecent(query)}
              />
            </View>
          ))}
          <ActionButton label="Clear all" onPress={() => void session.clearRecents()} />
        </View>
      )}
    </View>
  );
}

function ResultsPanel({
  session,
  top,
  rest,
  selectedIndex,
  onActivate,
  onSelect,
}: {
  session: SearchSession;
  top: Task[];
  rest: Task[];
  selectedIndex: number | null;
  onActivate: (task: Task) => void;
  onSelect: (index: number) => void;
}) {
  if (session.status === 'loading') {
    return <ActivityIndicator color={colors.muted} style={styles.empty} />;
  }
  if (session.status === 'error') {
    return (
      <View style={styles.failure}>
        <Text accessibilityRole="alert" style={styles.error}>
          Couldn’t search your tasks. Try again.
        </Text>
        <ActionButton label="Retry" onPress={session.retrySearch} />
      </View>
    );
  }
  if (session.status === 'ready' && session.tasks.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>No matching tasks.</Text>
        <Text style={styles.hint}>Every word has to appear in the title or description.</Text>
      </View>
    );
  }
  return (
    <View style={styles.section}>
      {session.status === 'updating' && (
        <ActivityIndicator color={colors.muted} style={styles.updating} />
      )}
      {top.length > 0 && (
        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.heading}>
            Top
          </Text>
          {top.map((task, index) => (
            <SearchResultRow
              key={task.id}
              task={task}
              selected={selectedIndex === index}
              onPress={() => onActivate(task)}
              onFocus={() => onSelect(index)}
            />
          ))}
        </View>
      )}
      {rest.length > 0 && (
        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.heading}>
            Tasks
          </Text>
          {rest.map((task, index) => {
            const absolute = top.length + index;
            return (
              <SearchResultRow
                key={task.id}
                task={task}
                selected={selectedIndex === absolute}
                onPress={() => onActivate(task)}
                onFocus={() => onSelect(absolute)}
              />
            );
          })}
        </View>
      )}
      {session.hasMore && (
        <View style={styles.loadMore}>
          <ActionButton label="Load more" onPress={session.loadMore} />
        </View>
      )}
    </View>
  );
}

function SearchResultRow({
  task,
  selected,
  onPress,
  onFocus,
}: {
  task: Task;
  selected: boolean;
  onPress: () => void;
  onFocus: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={task.title}
      accessibilityState={{ selected }}
      onPress={onPress}
      onFocus={onFocus}
      style={({ pressed }) => [styles.result, (pressed || selected) && styles.selected]}
    >
      <Text style={styles.resultTitle}>{task.title}</Text>
      {!!task.description && (
        <Text style={styles.resultDescription} numberOfLines={2}>
          {task.description}
        </Text>
      )}
      <LabelChipRow labels={task.labels} />
    </Pressable>
  );
}

function searchAnnouncement(session: SearchSession, blank: boolean): string {
  if (blank) {
    if (session.recentsError) return 'Couldn’t load recent searches.';
    if (session.recents.length === 0) return 'No recent searches.';
    return `${session.recents.length} recent ${session.recents.length === 1 ? 'search' : 'searches'}.`;
  }
  if (session.status === 'loading') return 'Searching.';
  if (session.status === 'updating') return 'Updating search results.';
  if (session.status === 'error') return 'Couldn’t search your tasks.';
  if (session.tasks.length === 0) return 'No matching tasks.';
  const extra = session.hasMore ? ' More results available.' : '';
  return `${session.tasks.length} ${session.tasks.length === 1 ? 'task' : 'tasks'}.${extra}`;
}

const styles = StyleSheet.create({
  host: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-start' },
  sheetWrap: { flex: 1, paddingTop: 48, paddingHorizontal: 12, paddingBottom: 12 },
  sheet: {
    flex: 1,
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  input: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 9,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 16,
  },
  live: { color: colors.muted, fontSize: 13, paddingHorizontal: 16, paddingVertical: 8 },
  body: { flex: 1 },
  bodyContent: { padding: 16, paddingBottom: 32, gap: 16 },
  section: { gap: 8 },
  heading: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  hint: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  recentQuery: { flex: 1, minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  recentText: { color: colors.text, fontSize: 15 },
  result: {
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 9,
    gap: 4,
  },
  selected: { backgroundColor: colors.hover },
  resultTitle: { color: colors.text, fontSize: 16, fontWeight: '500' },
  resultDescription: { color: colors.muted, fontSize: 14 },
  empty: { paddingVertical: 32, alignItems: 'center', gap: 10 },
  emptyTitle: { color: colors.text, fontSize: 17, textAlign: 'center' },
  failure: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  error: { color: colors.error, fontSize: 14, flex: 1 },
  loadMore: { alignSelf: 'flex-start', marginTop: 8 },
  updating: { alignSelf: 'flex-start' },
  pressed: { opacity: 0.7 },
});
