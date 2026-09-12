import { type ReactNode, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  type LabelColor,
  LabelDuplicateNameError,
  type LabelListItem,
  LabelNotFoundError,
  type LabelRepository,
} from '../../data/repositories';
import { ActionButton } from '../components/ActionButton';
import { LabelColorPicker } from '../components/LabelColorPicker';
import { TextField } from '../components/TextField';
import { confirmLabelDelete } from '../confirm-label-delete';
import { colors, hexForLabelColor } from '../theme';

interface LabelsScreenProps {
  repository: LabelRepository;
  onOpenLabel: (labelId: string) => void;
  leading?: ReactNode;
}

export function LabelsScreen({ repository, onOpenLabel, leading }: LabelsScreenProps) {
  const [labels, setLabels] = useState<LabelListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    void retry;
    setLoading(true);
    setError(false);
    return repository.subscribe(
      (items) => {
        setLabels(items);
        setLoading(false);
        setError(false);
      },
      () => {
        setError(true);
        setLoading(false);
      },
    );
  }, [repository, retry]);

  async function run(id: string, action: () => Promise<void>, failedMessage: string) {
    if (pendingId) return;
    setPendingId(id);
    setActionError(null);
    try {
      await action();
    } catch (cause) {
      setActionError(mapError(cause, failedMessage));
    } finally {
      setPendingId(null);
    }
  }

  async function remove(label: LabelListItem) {
    if (pendingId) return;
    setPendingId(label.id);
    setActionError(null);
    try {
      const affected = await repository.countAffectedTasks(label.id);
      const confirmed = await confirmLabelDelete(label.name, affected);
      if (!confirmed) return;
      await repository.delete(label.id);
      if (editingId === label.id) setEditingId(null);
    } catch (cause) {
      setActionError(mapError(cause, 'Couldn’t delete that label. Try again.'));
    } finally {
      setPendingId(null);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.heading}>
        {leading}
        <Text accessibilityRole="header" style={styles.title}>
          Labels
        </Text>
      </View>
      <Text style={styles.subtitle}>
        {loading ? '' : `${labels.length} ${labels.length === 1 ? 'label' : 'labels'}`}
      </Text>
      {adding ? (
        <LabelEditor
          submitLabel="Add"
          pending={pendingId === 'new'}
          onSubmit={(input) =>
            run(
              'new',
              async () => {
                await repository.create(input);
                setAdding(false);
              },
              'Couldn’t save that label. Try again.',
            )
          }
          onCancel={() => setAdding(false)}
        />
      ) : (
        <View style={styles.add}>
          <ActionButton
            label="+ Add label"
            color={colors.accent}
            disabled={pendingId != null}
            onPress={() => {
              setEditingId(null);
              setAdding(true);
            }}
          />
        </View>
      )}
      {actionError && (
        <Text accessibilityRole="alert" style={styles.error}>
          {actionError}
        </Text>
      )}
      {loading && <ActivityIndicator color={colors.muted} style={styles.empty} />}
      {error && (
        <View style={styles.failure}>
          <Text accessibilityRole="alert" style={styles.error}>
            Couldn’t load your labels.
          </Text>
          <ActionButton label="Retry" onPress={() => setRetry((value) => value + 1)} />
        </View>
      )}
      {!loading && !error && labels.length === 0 && !adding && (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No labels yet.</Text>
          <Text style={styles.emptyText}>
            Create a label to organize tasks across Inbox, Today, and Upcoming.
          </Text>
        </View>
      )}
      <View style={styles.list}>
        {labels.map((label) => (
          <View key={label.id} style={styles.row}>
            {editingId === label.id ? (
              <LabelEditor
                initialName={label.name}
                initialColor={label.color}
                submitLabel="Save"
                pending={pendingId === label.id}
                onSubmit={(input) =>
                  run(
                    label.id,
                    async () => {
                      await repository.update(label.id, input);
                      setEditingId(null);
                    },
                    'Couldn’t save that label. Try again.',
                  )
                }
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${label.name}, ${label.activeTaskCount} ${label.activeTaskCount === 1 ? 'task' : 'tasks'}`}
                  onPress={() => onOpenLabel(label.id)}
                  style={({ pressed }) => [styles.identity, pressed && styles.pressed]}
                >
                  <View style={[styles.dot, { backgroundColor: hexForLabelColor(label.color) }]} />
                  <View style={styles.body}>
                    <Text style={styles.name}>{label.name}</Text>
                    <Text style={styles.count}>
                      {label.activeTaskCount}{' '}
                      {label.activeTaskCount === 1 ? 'active task' : 'active tasks'}
                    </Text>
                  </View>
                </Pressable>
                <View style={styles.actions}>
                  <ActionButton
                    label={label.isFavorite ? '★' : '☆'}
                    accessibilityLabel={
                      label.isFavorite ? `Unfavorite ${label.name}` : `Favorite ${label.name}`
                    }
                    color={label.isFavorite ? colors.accent : colors.muted}
                    disabled={pendingId != null}
                    onPress={() =>
                      void run(
                        label.id,
                        () => repository.update(label.id, { isFavorite: !label.isFavorite }),
                        'Couldn’t update that label. Try again.',
                      )
                    }
                  />
                  <ActionButton
                    label="Edit"
                    disabled={pendingId != null}
                    onPress={() => {
                      setAdding(false);
                      setEditingId(label.id);
                    }}
                  />
                  <ActionButton
                    label="Delete"
                    color={colors.error}
                    disabled={pendingId != null}
                    onPress={() => void remove(label)}
                  />
                </View>
              </>
            )}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function LabelEditor({
  initialName = '',
  initialColor = 'charcoal',
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  initialName?: string;
  initialColor?: LabelColor;
  submitLabel: string;
  pending: boolean;
  onSubmit: (input: { name: string; color: LabelColor }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState<LabelColor>(initialColor);
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const trimmed = name.trim();
    if (trimmed.length < 1) {
      setError('Give your label a name.');
      return;
    }
    if (trimmed.length > 60) {
      setError('Use 60 characters or fewer.');
      return;
    }
    setError(null);
    onSubmit({ name: trimmed, color });
  }

  return (
    <View style={styles.editor}>
      <TextField
        label="Name"
        value={name}
        onChangeText={setName}
        editable={!pending}
        autoFocus
        maxLength={60}
      />
      <Text style={styles.colorLabel}>Color, {color.replaceAll('_', ' ')}</Text>
      <LabelColorPicker value={color} onChange={setColor} disabled={pending} />
      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      <View style={styles.editorActions}>
        <ActionButton label="Cancel" disabled={pending} onPress={onCancel} />
        <ActionButton
          label={pending ? '…' : submitLabel}
          disabled={pending || !name.trim()}
          accent
          onPress={submit}
        />
      </View>
    </View>
  );
}

function mapError(cause: unknown, fallback: string): string {
  if (cause instanceof LabelDuplicateNameError) return cause.message;
  if (cause instanceof LabelNotFoundError) return 'This label is no longer available.';
  return fallback;
}

const styles = StyleSheet.create({
  content: {
    width: '100%',
    maxWidth: 840,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 64,
    gap: 16,
  },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { color: colors.text, fontSize: 28, fontWeight: '700' },
  subtitle: { color: colors.muted, fontSize: 13, marginTop: -8 },
  add: { alignSelf: 'flex-start' },
  list: { gap: 8 },
  row: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 12,
    gap: 12,
  },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  pressed: { opacity: 0.7 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  body: { flex: 1, gap: 2 },
  name: { color: colors.text, fontSize: 16, fontWeight: '600' },
  count: { color: colors.muted, fontSize: 13 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  editor: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.surface,
    padding: 16,
    gap: 12,
  },
  colorLabel: { color: colors.muted, fontSize: 13, fontWeight: '500', textTransform: 'capitalize' },
  editorActions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  empty: { paddingVertical: 64, alignItems: 'center', gap: 10 },
  emptyTitle: { color: colors.text, fontSize: 17, textAlign: 'center' },
  emptyText: { color: colors.muted, fontSize: 14, textAlign: 'center' },
  failure: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  error: { color: colors.error, fontSize: 14, flex: 1 },
});
