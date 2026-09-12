import type { Task, TaskInput } from '../data/repositories';

export function splitTodayGroups(
  tasks: Task[],
  today: string,
): { overdue: Task[]; dueToday: Task[] } {
  const overdue: Task[] = [];
  const dueToday: Task[] = [];
  for (const task of tasks) {
    if (task.scheduledDate == null) continue;
    if (task.scheduledDate < today) overdue.push(task);
    else dueToday.push(task);
  }
  return { overdue, dueToday };
}

export function groupTasksByScheduledDate(tasks: Task[]): Array<{ date: string; tasks: Task[] }> {
  const groups: Array<{ date: string; tasks: Task[] }> = [];
  for (const task of tasks) {
    if (task.scheduledDate == null) continue;
    const last = groups.at(-1);
    if (last && last.date === task.scheduledDate) last.tasks.push(task);
    else groups.push({ date: task.scheduledDate, tasks: [task] });
  }
  return groups;
}

/** Preserve time when choosing another date; clearing the date also clears time. */
export function rescheduleInput(task: Task, scheduledDate: string | null): TaskInput {
  return {
    title: task.title,
    description: task.description,
    priority: task.priority,
    scheduledDate,
    scheduledTime: scheduledDate == null ? null : task.scheduledTime,
  };
}
