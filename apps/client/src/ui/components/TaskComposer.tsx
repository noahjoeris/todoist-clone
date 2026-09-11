import type { TaskInput } from '../../data/repositories';
import { emptyTaskDraft, TaskForm } from './TaskForm';

interface TaskComposerProps {
  onCreate: (input: TaskInput) => Promise<void>;
  onClose: () => void;
}

export function TaskComposer({ onCreate, onClose }: TaskComposerProps) {
  return (
    <TaskForm
      initial={emptyTaskDraft}
      onSubmit={onCreate}
      onClose={onClose}
      submitLabel="↑"
      submitAccessibilityLabel="Add task"
      cancelAccessibilityLabel="Cancel task"
      autoFocus
    />
  );
}
