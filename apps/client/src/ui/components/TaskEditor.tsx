import { useRef } from 'react';
import type { LabelRepository, Task, TaskInput } from '../../data/repositories';
import { emptyTaskDraft, TaskForm, type TaskFormDraft } from './TaskForm';
import { labelIdsFromTask } from './task-editor';

interface TaskEditorProps {
  task: Task | null;
  missing: boolean;
  onSave: (input: TaskInput, labelIds?: string[]) => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
  today?: string;
  registerDirtyCheck?: (isDirty: () => boolean) => () => void;
  labels?: LabelRepository;
}

export function TaskEditor({
  task,
  missing,
  onSave,
  onDelete,
  onClose,
  today,
  registerDirtyCheck,
  labels,
}: TaskEditorProps) {
  // ADR-019: keep the open-editor baseline at mount; live sync must not replace it.
  const initialLabelIds = useRef(labelIdsFromTask(task)).current;
  return (
    <TaskForm
      initial={task ? draftFromTask(task) : emptyTaskDraft}
      onSubmit={onSave}
      onClose={onClose}
      onDelete={onDelete}
      missing={missing}
      submitLabel="Save"
      submitAccessibilityLabel="Save task"
      cancelAccessibilityLabel="Cancel editing"
      autoFocus={!missing}
      submitLabels="when-changed"
      {...(today !== undefined ? { today } : {})}
      {...(registerDirtyCheck ? { registerDirtyCheck } : {})}
      {...(labels ? { labels, initialLabelIds } : {})}
    />
  );
}

function draftFromTask(task: Task): TaskFormDraft {
  return {
    title: task.title,
    description: task.description,
    priority: task.priority,
    date: task.scheduledDate,
    time: task.scheduledTime ?? '',
  };
}
