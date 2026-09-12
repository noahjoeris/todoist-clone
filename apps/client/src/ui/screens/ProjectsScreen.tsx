import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  activeProjects,
  archivedProjects,
  type LabelColor,
  ProjectDuplicateNameError,
  type ProjectListItem,
  ProjectNotFoundError,
  ProjectOperationTooLargeError,
  type ProjectRepository,
  ProjectStaleListError,
} from '../../data/repositories';
import { ActionButton } from '../components/ActionButton';
import { LabelColorPicker } from '../components/LabelColorPicker';
import { TextField } from '../components/TextField';
import { confirmProjectDelete } from '../confirm-project-delete';
import { type ProjectsTab, projectsTabForCreate } from '../project-create-form';
import { colors, hexForLabelColor, nameForLabelColor } from '../theme';

interface ProjectsScreenProps {
  repository: ProjectRepository;
  onOpenProject: (projectId: string) => void;
  adding?: boolean;
  onAddingChange?: (adding: boolean) => void;
  leading?: ReactNode;
}

export function ProjectsScreen({
  repository,
  onOpenProject,
  adding = false,
  onAddingChange,
  leading,
}: ProjectsScreenProps) {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tab, setTab] = useState<ProjectsTab>('active');
  const visibleTab = projectsTabForCreate(adding, tab);

  const visible = useMemo(
    () => (visibleTab === 'active' ? activeProjects(projects) : archivedProjects(projects)),
    [projects, visibleTab],
  );

  useEffect(() => {
    if (!adding) return;
    setEditingId(null);
  }, [adding]);

  function setAdding(next: boolean) {
    onAddingChange?.(next);
  }

  useEffect(() => {
    void retry;
    setLoading(true);
    setError(false);
    return repository.subscribe(
      (items) => {
        setProjects(items);
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

  async function remove(project: ProjectListItem) {
    if (pendingId) return;
    setPendingId(project.id);
    setActionError(null);
    try {
      const affected = await repository.countAffectedTasks(project.id);
      const confirmed = await confirmProjectDelete(project.name, affected);
      if (!confirmed) return;
      await repository.delete(project.id);
      if (editingId === project.id) setEditingId(null);
    } catch (cause) {
      setActionError(mapError(cause, 'Couldn’t delete that project. Try again.'));
    } finally {
      setPendingId(null);
    }
  }

  async function move(project: ProjectListItem, direction: -1 | 1) {
    const active = activeProjects(projects);
    const index = active.findIndex((item) => item.id === project.id);
    const swapWith = index + direction;
    if (index < 0 || swapWith < 0 || swapWith >= active.length) return;
    const ordered = active.map((item) => item.id);
    const swapId = ordered[swapWith];
    const currentId = ordered[index];
    if (swapId === undefined || currentId === undefined) return;
    ordered[index] = swapId;
    ordered[swapWith] = currentId;
    await run(
      project.id,
      () => repository.reorder(ordered),
      'Couldn’t reorder that project. Try again.',
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.heading}>
        {leading}
        <Text accessibilityRole="header" style={styles.title}>
          Projects
        </Text>
      </View>
      <Text style={styles.subtitle}>
        {loading
          ? ''
          : `${visible.length} ${visible.length === 1 ? 'project' : 'projects'}${visibleTab === 'archived' ? ' archived' : ''}`}
      </Text>
      <View style={styles.tabs} accessibilityRole="tablist">
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: visibleTab === 'active' }}
          onPress={() => setTab('active')}
          style={[styles.tab, visibleTab === 'active' && styles.tabSelected]}
        >
          <Text style={[styles.tabLabel, visibleTab === 'active' && styles.tabLabelSelected]}>
            Active
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: visibleTab === 'archived' }}
          onPress={() => setTab('archived')}
          style={[styles.tab, visibleTab === 'archived' && styles.tabSelected]}
        >
          <Text style={[styles.tabLabel, visibleTab === 'archived' && styles.tabLabelSelected]}>
            Archived
          </Text>
        </Pressable>
      </View>
      {adding && visibleTab === 'active' ? (
        <ProjectEditor
          submitLabel="Add"
          pending={pendingId === 'new'}
          onSubmit={(input) =>
            run(
              'new',
              async () => {
                await repository.create(input);
                setAdding(false);
              },
              'Couldn’t save that project. Try again.',
            )
          }
          onCancel={() => setAdding(false)}
        />
      ) : (
        visibleTab === 'active' && (
          <View style={styles.add}>
            <ActionButton
              label="+ Add project"
              color={colors.accent}
              disabled={pendingId != null}
              onPress={() => {
                setEditingId(null);
                setAdding(true);
              }}
            />
          </View>
        )
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
            Couldn’t load your projects.
          </Text>
          <ActionButton label="Retry" onPress={() => setRetry((value) => value + 1)} />
        </View>
      )}
      {!loading && !error && visible.length === 0 && !adding && (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>
            {visibleTab === 'active' ? 'No projects yet.' : 'No archived projects.'}
          </Text>
          <Text style={styles.emptyText}>
            {visibleTab === 'active'
              ? 'Create a project to organize tasks beyond Inbox.'
              : 'Archived projects stay here with their tasks until you unarchive or delete them.'}
          </Text>
        </View>
      )}
      <View style={styles.list}>
        {visible.map((project, index) => (
          <View key={project.id} style={styles.row}>
            {editingId === project.id ? (
              <ProjectEditor
                initialName={project.name}
                initialColor={project.color}
                submitLabel="Save"
                pending={pendingId === project.id}
                onSubmit={(input) =>
                  run(
                    project.id,
                    async () => {
                      await repository.update(project.id, input);
                      setEditingId(null);
                    },
                    'Couldn’t save that project. Try again.',
                  )
                }
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${project.name}, ${project.activeTaskCount} ${project.activeTaskCount === 1 ? 'task' : 'tasks'}${project.isArchived ? ', archived' : ''}`}
                  onPress={() => onOpenProject(project.id)}
                  style={({ pressed }) => [styles.identity, pressed && styles.pressed]}
                >
                  <View
                    style={[styles.dot, { backgroundColor: hexForLabelColor(project.color) }]}
                  />
                  <View style={styles.body}>
                    <Text style={styles.name}>{project.name}</Text>
                    <Text style={styles.count}>
                      {project.activeTaskCount}{' '}
                      {project.activeTaskCount === 1 ? 'active task' : 'active tasks'}
                      {project.isFavorite && !project.isArchived ? ' · Favorite' : ''}
                    </Text>
                  </View>
                </Pressable>
                <View style={styles.actions}>
                  {visibleTab === 'active' && (
                    <>
                      <ActionButton
                        label={project.isFavorite ? '★' : '☆'}
                        accessibilityLabel={
                          project.isFavorite
                            ? `Unfavorite ${project.name}`
                            : `Favorite ${project.name}`
                        }
                        color={project.isFavorite ? colors.accent : colors.muted}
                        disabled={pendingId != null}
                        onPress={() =>
                          void run(
                            project.id,
                            () =>
                              repository.update(project.id, { isFavorite: !project.isFavorite }),
                            'Couldn’t update that project. Try again.',
                          )
                        }
                      />
                      <ActionButton
                        label="Move up"
                        disabled={pendingId != null || index === 0}
                        onPress={() => void move(project, -1)}
                      />
                      <ActionButton
                        label="Move down"
                        disabled={pendingId != null || index === visible.length - 1}
                        onPress={() => void move(project, 1)}
                      />
                      <ActionButton
                        label="Archive"
                        disabled={pendingId != null}
                        onPress={() =>
                          void run(
                            project.id,
                            () => repository.setArchived(project.id, true),
                            'Couldn’t archive that project. Try again.',
                          )
                        }
                      />
                    </>
                  )}
                  {visibleTab === 'archived' && (
                    <ActionButton
                      label="Unarchive"
                      disabled={pendingId != null}
                      onPress={() =>
                        void run(
                          project.id,
                          () => repository.setArchived(project.id, false),
                          'Couldn’t unarchive that project. Try again.',
                        )
                      }
                    />
                  )}
                  <ActionButton
                    label="Edit"
                    disabled={pendingId != null}
                    onPress={() => {
                      setAdding(false);
                      setEditingId(project.id);
                    }}
                  />
                  <ActionButton
                    label="Delete"
                    color={colors.error}
                    disabled={pendingId != null}
                    onPress={() => void remove(project)}
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

function ProjectEditor({
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
      setError('Give your project a name.');
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
      <Text style={styles.colorLabel}>Color, {nameForLabelColor(color)}</Text>
      <LabelColorPicker
        value={color}
        onChange={setColor}
        disabled={pending}
        accessibilityLabel="Project color"
      />
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
  if (cause instanceof ProjectDuplicateNameError) return cause.message;
  if (cause instanceof ProjectNotFoundError) return 'This project is no longer available.';
  if (cause instanceof ProjectStaleListError) return cause.message;
  if (cause instanceof ProjectOperationTooLargeError) return cause.message;
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
  tabs: { flexDirection: 'row', gap: 8 },
  tab: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 9,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabSelected: { backgroundColor: colors.hover, borderColor: colors.text },
  tabLabel: { color: colors.muted, fontSize: 14, fontWeight: '600' },
  tabLabelSelected: { color: colors.text },
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
  colorLabel: { color: colors.muted, fontSize: 13, fontWeight: '500' },
  editorActions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  empty: { paddingVertical: 64, alignItems: 'center', gap: 10 },
  emptyTitle: { color: colors.text, fontSize: 17, textAlign: 'center' },
  emptyText: { color: colors.muted, fontSize: 14, textAlign: 'center' },
  failure: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  error: { color: colors.error, fontSize: 14, flex: 1 },
});
