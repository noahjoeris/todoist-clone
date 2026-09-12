import type { TaskInput } from '../../data/repositories';
import { emptyTaskDraft, TaskForm, type TaskFormDraft } from './TaskForm';

interface TaskComposerProps {
  onCreate: (input: TaskInput) => Promise<void>;
  onClose: () => void;
  initialDate?: string | null;
  today?: string;
  registerDirtyCheck?: (isDirty: () => boolean) => () => void;
}

export function TaskComposer({
  onCreate,
  onClose,
  initialDate = null,
  today,
  registerDirtyCheck,
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
      {...(today !== undefined ? { today } : {})}
      {...(registerDirtyCheck ? { registerDirtyCheck } : {})}
    />
  );
}
