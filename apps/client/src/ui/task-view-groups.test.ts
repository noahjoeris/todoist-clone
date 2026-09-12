import { describe, expect, it } from 'vitest';
import type { Task } from '../data/repositories';
import { groupTasksByScheduledDate, rescheduleInput, splitTodayGroups } from './task-view-groups';

function task(overrides: Partial<Task> & Pick<Task, 'id' | 'title'>): Task {
  return {
    description: '',
    priority: 4,
    scheduledDate: null,
    scheduledTime: null,
    completedAt: null,
    createdAt: '2026-09-10T08:00:00.000Z',
    labels: [],
    projectId: null,
    project: null,
    ...overrides,
  };
}

describe('task view grouping', () => {
  it('splits overdue and today without treating unscheduled rows as overdue', () => {
    const overdue = task({ id: 'o', title: 'Overdue', scheduledDate: '2026-09-11' });
    const dueToday = task({ id: 't', title: 'Today', scheduledDate: '2026-09-12' });
    const unscheduled = task({ id: 'u', title: 'Inbox' });
    const grouped = splitTodayGroups([overdue, unscheduled, dueToday], '2026-09-12');
    expect(grouped.overdue.map((item) => item.id)).toEqual(['o']);
    expect(grouped.dueToday.map((item) => item.id)).toEqual(['t']);
  });

  it('groups upcoming tasks by populated dates only', () => {
    const groups = groupTasksByScheduledDate([
      task({ id: 'a', title: 'A', scheduledDate: '2026-09-13' }),
      task({ id: 'b', title: 'B', scheduledDate: '2026-09-13' }),
      task({ id: 'c', title: 'C', scheduledDate: '2026-09-14' }),
    ]);
    expect(groups).toEqual([
      {
        date: '2026-09-13',
        tasks: [expect.objectContaining({ id: 'a' }), expect.objectContaining({ id: 'b' })],
      },
      { date: '2026-09-14', tasks: [expect.objectContaining({ id: 'c' })] },
    ]);
  });

  it('preserves time when changing date and clears time with the date', () => {
    const timed = task({
      id: 't',
      title: 'Call',
      scheduledDate: '2026-09-12',
      scheduledTime: '14:30',
      priority: 2,
      description: 'Notes',
    });
    expect(rescheduleInput(timed, '2026-09-13')).toEqual({
      title: 'Call',
      description: 'Notes',
      priority: 2,
      scheduledDate: '2026-09-13',
      scheduledTime: '14:30',
    });
    expect(rescheduleInput(timed, null)).toEqual({
      title: 'Call',
      description: 'Notes',
      priority: 2,
      scheduledDate: null,
      scheduledTime: null,
    });
  });
});
