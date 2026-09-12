import type { LabelRepository, TaskInput } from '../../data/repositories';
import { emptyTaskDraft, TaskForm, type TaskFormDraft } from './TaskForm';

interface TaskComposerProps {
  onCreate: (input: TaskInput, labelIds?: string[]) => Promise<void>;
  onClose: () => void;
  initialDate?: string | null;
  today?: string;
  registerDirtyCheck?: (isDirty: () => boolean) => () => void;
  labels?: LabelRepository;
  initialLabelIds?: string[];
}

export function TaskComposer({
  onCreate,
  onClose,
  initialDate = null,
  today,
  registerDirtyCheck,
  labels,
  initialLabelIds,
}: TaskComposerProps) {
  const initial: TaskFormDraft = { ...emptyTaskDraft, date: initialDate };
  return (
    <TaskForm
      initial={initial}
      onSubmit={onCreate}
      onClose={onClose}
      submitLabel="↑"
      submitAccessibilityLabel="Add task"
      cancelAccessibilityLabel="Cancel task"
      autoFocus
      submitLabels="always"
      {...(today !== undefined ? { today } : {})}
      {...(registerDirtyCheck ? { registerDirtyCheck } : {})}
      {...(labels ? { labels } : {})}
      {...(initialLabelIds ? { initialLabelIds } : {})}
    />
  );
}
