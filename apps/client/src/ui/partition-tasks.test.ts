import { describe, expect, it } from 'vitest';
import type { Task } from '../data/repositories';
import { partitionTasks } from './partition-tasks';

function task(overrides: Partial<Task> & Pick<Task, 'id' | 'title'>): Task {
  return {
    description: '',
    priority: 4,
    scheduledDate: null,
    scheduledTime: null,
    completedAt: null,
    createdAt: '2026-09-10T08:00:00.000Z',
    labels: [],
    ...overrides,
  };
}

describe('partitionTasks', () => {
  it('keeps active tasks in list order and sorts completed by time then id', () => {
    const activeLater = task({ id: 'a2', title: 'Active later' });
    const activeEarlier = task({ id: 'a1', title: 'Active earlier' });
    const doneNew = task({
      id: 'c2',
      title: 'Done new',
      completedAt: '2026-09-11T12:00:00.000Z',
    });
    const doneOld = task({
      id: 'c1',
      title: 'Done old',
      completedAt: '2026-09-11T11:00:00.000Z',
    });
    const doneSameTimeHigherId = task({
      id: 'c9',
      title: 'Tie high',
      completedAt: '2026-09-11T12:00:00.000Z',
    });

    const { active, completed } = partitionTasks([
      activeLater,
      doneOld,
      doneSameTimeHigherId,
      activeEarlier,
      doneNew,
    ]);

    expect(active.map((item) => item.id)).toEqual(['a2', 'a1']);
    expect(completed.map((item) => item.id)).toEqual(['c9', 'c2', 'c1']);
  });
});
