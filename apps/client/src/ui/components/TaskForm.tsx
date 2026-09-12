import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import {
  type LabelListItem,
  type LabelRepository,
  labelIdsForSubmit,
  type ProjectListItem,
  ProjectNotFoundError,
  type ProjectRepository,
  projectIdForSubmit,
  sameIdSet,
  type TaskInput,
  TaskNotFoundError,
  type TaskPriority,
  taskInputSchema,
} from '../../data/repositories';
import { confirmDiscard } from '../discard-draft';
import { isProjectSelectionValid } from '../project-picker';
import { colors, priorityColors } from '../theme';
import { ActionButton } from './ActionButton';
import { LabelChipRow } from './LabelChip';
import { LabelPicker } from './LabelPicker';
import { ProjectPicker } from './ProjectPicker';
import { TaskDatePicker } from './TaskDatePicker';
import { dateLabel, toCalendarDate } from './task-date';
import { isTaskSubmitDisabled } from './task-form';

export interface TaskFormDraft {
  title: string;
  description: string;
  priority: TaskPriority;
  date: string | null;
  time: string;
}

export const emptyTaskDraft: TaskFormDraft = {
  title: '',
  description: '',
  priority: 4,
  date: null,
  time: '',
};

interface TaskFormProps {
  initial: TaskFormDraft;
  onSubmit: (input: TaskInput, labelIds?: string[], projectId?: string | null) => Promise<void>;
  onClose: () => void;
  submitLabel: string;
  submitAccessibilityLabel: string;
  cancelAccessibilityLabel: string;
  onDelete?: () => Promise<void>;
  missing?: boolean;
  autoFocus?: boolean;
  today?: string;
  registerDirtyCheck?: (isDirty: () => boolean) => () => void;
  labels?: LabelRepository;
  initialLabelIds?: string[];
  /** Composer always sends the selection; the editor omits it when unchanged. */
  submitLabels?: 'always' | 'when-changed';
  projects?: ProjectRepository;
  initialProjectId?: string | null;
  submitProject?: 'always' | 'when-changed';
}

export function TaskForm({
  initial,
  onSubmit,
  onClose,
  submitLabel,
  submitAccessibilityLabel,
  cancelAccessibilityLabel,
  onDelete,
  missing = false,
  autoFocus = false,
  today = toCalendarDate(new Date()),
  registerDirtyCheck,
  labels: labelsRepository,
  initialLabelIds = [],
  submitLabels = 'when-changed',
  projects: projectsRepository,
  initialProjectId = null,
  submitProject = 'when-changed',
}: TaskFormProps) {
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [priority, setPriority] = useState<TaskPriority>(initial.priority);
  const [date, setDate] = useState<string | null>(initial.date);
  const [time, setTime] = useState(initial.time);
  const [panel, setPanel] = useState<'date' | 'priority' | 'labels' | 'project' | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [labelCatalog, setLabelCatalog] = useState<LabelListItem[]>([]);
  const [labelsReady, setLabelsReady] = useState(false);
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>(initialLabelIds);
  const [creatingLabel, setCreatingLabel] = useState(false);
  const [projectCatalog, setProjectCatalog] = useState<ProjectListItem[]>([]);
  const [projectsReady, setProjectsReady] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(initialProjectId);
  const submitting = useRef(false);
  const creatingLabelRef = useRef(false);
  const baselineLabelIds = useRef(initialLabelIds).current;
  const baselineProjectId = useRef(initialProjectId).current;
  const busy = saving || deleting;
  const fieldsDisabled = busy || missing;
  const showLabels = labelsRepository != null;
  const showProjects = projectsRepository != null;
  const projectSelectionValid = !showProjects
    ? true
    : isProjectSelectionValid(selectedProjectId, projectCatalog, projectsReady);
  const selectedProject =
    selectedProjectId == null
      ? null
      : (projectCatalog.find((project) => project.id === selectedProjectId) ?? null);

  function onLabelCreatingChange(pending: boolean) {
    creatingLabelRef.current = pending;
    setCreatingLabel(pending);
  }

  useEffect(() => {
    if (!labelsRepository) return;
    setLabelsReady(false);
    return labelsRepository.subscribe(
      (items) => {
        setLabelCatalog(items);
        setLabelsReady(true);
      },
      () => {},
    );
  }, [labelsRepository]);

  useEffect(() => {
    if (!projectsRepository) return;
    setProjectsReady(false);
    return projectsRepository.subscribe(
      (items) => {
        setProjectCatalog(items);
        setProjectsReady(true);
      },
      () => {
        setProjectsReady(true);
      },
    );
  }, [projectsRepository]);

  useEffect(() => {
    if (!showLabels || !labelsReady) return;
    const available = new Set(labelCatalog.map((label) => label.id));
    setSelectedLabelIds((current) => {
      const next = current.filter((id) => available.has(id));
      return next.length === current.length ? current : next;
    });
  }, [labelCatalog, labelsReady, showLabels]);

  useEffect(() => registerDirtyCheck?.(() => isDirty()));

  function isDirty() {
    return (
      title !== initial.title ||
      description !== initial.description ||
      priority !== initial.priority ||
      date !== initial.date ||
      time !== initial.time ||
      (showLabels && !sameIdSet(selectedLabelIds, baselineLabelIds)) ||
      (showProjects && selectedProjectId !== baselineProjectId)
    );
  }

  async function submit() {
    if (submitting.current || missing || creatingLabelRef.current || !projectSelectionValid) return;
    const result = taskInputSchema.safeParse({
      title,
      description,
      priority,
      scheduledDate: date,
      scheduledTime: time.trim() || null,
    });
    if (!result.success) {
      setError(
        result.error.issues[0]?.path[0] === 'scheduledTime'
          ? 'Enter a valid 24-hour time, such as 14:30, or leave it empty.'
          : (result.error.issues[0]?.message ?? 'Check your task details.'),
      );
      return;
    }
    submitting.current = true;
    setSaving(true);
    setError(null);
    setPanel(null);
    try {
      const labelIds = showLabels
        ? labelIdsForSubmit(selectedLabelIds, baselineLabelIds, submitLabels)
        : undefined;
      const projectId = showProjects
        ? projectIdForSubmit(selectedProjectId, baselineProjectId, submitProject)
        : undefined;
      await onSubmit(result.data, labelIds, projectId);
      onClose();
    } catch (cause) {
      setError(
        cause instanceof TaskNotFoundError
          ? 'This task is no longer available.'
          : cause instanceof ProjectNotFoundError
            ? 'This project is no longer available. Choose Inbox or another project.'
            : 'Couldn’t save your task. Your draft is here—try again.',
      );
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  async function close() {
    if (submitting.current) return;
    if (!missing && isDirty()) {
      const discard = await confirmDiscard();
      if (!discard) return;
    }
    onClose();
  }

  async function remove() {
    if (!onDelete || submitting.current || missing) return;
    submitting.current = true;
    setDeleting(true);
    setError(null);
    try {
      await onDelete();
      onClose();
    } catch (cause) {
      setError(
        cause instanceof TaskNotFoundError
          ? 'This task is no longer available.'
          : 'Couldn’t delete that task. Try again.',
      );
    } finally {
      submitting.current = false;
      setDeleting(false);
    }
  }

  return (
    <View style={styles.composer}>
      {missing && (
        <Text accessibilityRole="alert" style={styles.error}>
          This task is no longer available.
        </Text>
      )}
      <TextInput
        accessibilityLabel="Task name"
        placeholder="Task name"
        placeholderTextColor={colors.muted}
        value={title}
        onChangeText={setTitle}
        autoFocus={autoFocus}
        editable={!fieldsDisabled}
        style={styles.title}
        returnKeyType="done"
        submitBehavior="submit"
        onSubmitEditing={() => void submit()}
        onKeyPress={({ nativeEvent }) => {
          if (nativeEvent.key === 'Escape') void close();
        }}
      />
      <TextInput
        accessibilityLabel="Description"
        placeholder="Description"
        placeholderTextColor={colors.muted}
        value={description}
        onChangeText={setDescription}
        editable={!fieldsDisabled}
        multiline
        style={styles.description}
        onKeyPress={({ nativeEvent }) => {
          if (nativeEvent.key === 'Escape') void close();
        }}
      />
      <View style={styles.toolbar}>
        <View style={styles.options}>
          <ActionButton
            label={
              date
                ? `${dateLabel(date, new Date(`${today}T12:00:00`))}${time ? ` · ${time}` : ''}`
                : 'Date'
            }
            accessibilityLabel="Choose date and time"
            color={date ? colors.green : colors.muted}
            disabled={fieldsDisabled}
            selected={panel === 'date'}
            onPress={() => setPanel(panel === 'date' ? null : 'date')}
          />
          <ActionButton
            label={priority === 4 ? '⚑ Priority' : `⚑ P${priority}`}
            accessibilityLabel={`Priority ${priority}. Change priority`}
            color={priorityColors[priority]}
            disabled={fieldsDisabled}
            selected={panel === 'priority'}
            onPress={() => setPanel(panel === 'priority' ? null : 'priority')}
          />
          {showLabels && (
            <ActionButton
              label={
                selectedLabelIds.length === 0
                  ? 'Labels'
                  : `${selectedLabelIds.length} ${selectedLabelIds.length === 1 ? 'label' : 'labels'}`
              }
              accessibilityLabel="Choose labels"
              color={selectedLabelIds.length > 0 ? colors.accent : colors.muted}
              disabled={fieldsDisabled}
              selected={panel === 'labels'}
              onPress={() => setPanel(panel === 'labels' ? null : 'labels')}
            />
          )}
          {showProjects && (
            <ActionButton
              label={
                selectedProject
                  ? `${selectedProject.name}${selectedProject.isArchived ? ' · Archived' : ''}`
                  : selectedProjectId
                    ? 'Unavailable project'
                    : 'Inbox'
              }
              accessibilityLabel="Choose project"
              color={selectedProjectId ? colors.accent : colors.muted}
              disabled={fieldsDisabled}
              selected={panel === 'project'}
              onPress={() => setPanel(panel === 'project' ? null : 'project')}
            />
          )}
        </View>
        <View style={styles.actions}>
          {onDelete && (
            <ActionButton
              label={deleting ? '…' : 'Delete'}
              accessibilityLabel={deleting ? 'Deleting task' : 'Delete task'}
              color={colors.error}
              onPress={() => void remove()}
              disabled={busy || missing}
            />
          )}
          <ActionButton
            label="×"
            accessibilityLabel={cancelAccessibilityLabel}
            onPress={() => void close()}
            disabled={busy}
          />
          <ActionButton
            label={saving ? '…' : submitLabel}
            accessibilityLabel={saving ? 'Saving task' : submitAccessibilityLabel}
            onPress={() => void submit()}
            disabled={isTaskSubmitDisabled({
              busy,
              missing,
              title,
              creatingLabel,
              ...(showProjects
                ? { projectsReady, projectSelectionInvalid: !projectSelectionValid }
                : {}),
            })}
            accent
          />
        </View>
      </View>
      {panel === 'date' && !fieldsDisabled && (
        <TaskDatePicker
          date={date}
          time={time}
          today={today}
          onDateChange={setDate}
          onTimeChange={setTime}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === 'priority' && !fieldsDisabled && (
        <View style={styles.priorities}>
          {([1, 2, 3, 4] as const).map((value) => (
            <ActionButton
              key={value}
              label={`⚑ P${value}`}
              accessibilityLabel={`Priority ${value}`}
              color={priorityColors[value]}
              selected={priority === value}
              onPress={() => {
                setPriority(value);
                setPanel(null);
              }}
            />
          ))}
        </View>
      )}
      {panel === 'labels' && showLabels && labelsRepository && !fieldsDisabled && (
        <LabelPicker
          labels={labelCatalog}
          selectedIds={selectedLabelIds}
          onChange={setSelectedLabelIds}
          onCreate={(name) => labelsRepository.create({ name })}
          onCreatingChange={onLabelCreatingChange}
          disabled={fieldsDisabled}
        />
      )}
      {panel === 'project' && showProjects && !fieldsDisabled && (
        <ProjectPicker
          projects={projectCatalog}
          selectedId={selectedProjectId}
          onChange={setSelectedProjectId}
          disabled={fieldsDisabled}
        />
      )}
      {showProjects && !projectSelectionValid && projectsReady && (
        <Text accessibilityRole="alert" style={styles.error}>
          This project is no longer available. Choose Inbox or another project.
        </Text>
      )}
      {showLabels && selectedLabelIds.length > 0 && panel !== 'labels' && (
        <LabelChipRow
          labels={labelCatalog.filter((label) => selectedLabelIds.includes(label.id))}
        />
      )}
      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  composer: {
    borderWidth: 1,
    borderColor: '#686868',
    borderRadius: 16,
    backgroundColor: colors.surface,
    padding: 16,
    gap: 12,
  },
  title: { color: colors.text, fontSize: 20, padding: 0, minHeight: 32 },
  description: {
    color: colors.text,
    fontSize: 15,
    padding: 0,
    minHeight: 32,
    maxHeight: 160,
    textAlignVertical: 'top',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'space-between',
    marginTop: 4,
  },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, flexShrink: 1 },
  actions: { flexDirection: 'row', gap: 8, marginLeft: 'auto' },
  priorities: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  error: { color: colors.error, fontSize: 14 },
});
