import type { Task, TaskInput } from '../../data/repositories';
import { emptyTaskDraft, TaskForm, type TaskFormDraft } from './TaskForm';

interface TaskEditorProps {
  task: Task | null;
  missing: boolean;
  onSave: (input: TaskInput) => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
}

export function TaskEditor({ task, missing, onSave, onDelete, onClose }: TaskEditorProps) {
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
