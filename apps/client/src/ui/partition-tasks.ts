import type { Task } from '../data/repositories';

export function partitionTasks(tasks: Task[]): { active: Task[]; completed: Task[] } {
  const active: Task[] = [];
  const completed: Task[] = [];
  for (const task of tasks) {
    if (task.completedAt == null) active.push(task);
    else completed.push(task);
  }
  completed.sort((left, right) => {
    const byTime = (right.completedAt ?? '').localeCompare(left.completedAt ?? '');
    if (byTime !== 0) return byTime;
    return right.id.localeCompare(left.id);
  });
  return { active, completed };
}
