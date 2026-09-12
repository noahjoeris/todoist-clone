import { describe, expect, it } from 'vitest';
import { projectIdForSubmit, taskInputSchema } from './task';

describe('task input', () => {
  it('normalizes a title-only task and supplies defaults', () => {
    expect(taskInputSchema.parse({ title: '  Buy groceries  ' })).toEqual({
      title: 'Buy groceries',
      description: '',
      priority: 4,
      scheduledDate: null,
      scheduledTime: null,
    });
  });

  it('preserves a date-only schedule and multiline description', () => {
    expect(
      taskInputSchema.parse({
        title: 'Plan',
        description: '  First\nSecond  ',
        scheduledDate: '2028-02-29',
      }),
    ).toMatchObject({
      description: 'First\nSecond',
      scheduledDate: '2028-02-29',
      scheduledTime: null,
    });
  });

  it.each(['00:00', '14:30', '23:59'])('accepts time %s with a date', (scheduledTime) => {
    expect(
      taskInputSchema.parse({ title: 'Plan', scheduledDate: '2026-09-09', scheduledTime })
        .scheduledTime,
    ).toBe(scheduledTime);
  });

  it.each([
    { title: ' \n ' },
    { priority: 0 },
    { priority: 5 },
    { priority: 1.5 },
    { scheduledDate: '2026-02-29' },
    { scheduledDate: '2026-04-31' },
    { scheduledDate: '2026-13-01' },
    { scheduledDate: '2026-1-01' },
    { scheduledTime: '14:30' },
    { scheduledDate: '2026-09-09', scheduledTime: '24:00' },
    { scheduledDate: '2026-09-09', scheduledTime: '12:60' },
    { scheduledDate: '2026-09-09', scheduledTime: '12:30:00' },
    { scheduledDate: '2026-09-09', scheduledTime: '9:30' },
  ])('rejects invalid input %j', (input) => {
    expect(taskInputSchema.safeParse({ title: 'Plan', ...input }).success).toBe(false);
  });
});

describe('project membership submit', () => {
  it('always sends the composer selection, including Inbox', () => {
    expect(projectIdForSubmit(null, null, 'always')).toBeNull();
    expect(projectIdForSubmit('p1', null, 'always')).toBe('p1');
  });

  it('omits an untouched editor selection so a remote move survives a title-only save', () => {
    expect(projectIdForSubmit('p1', 'p1', 'when-changed')).toBeUndefined();
    expect(projectIdForSubmit(null, 'p1', 'when-changed')).toBeNull();
    expect(projectIdForSubmit('p2', 'p1', 'when-changed')).toBe('p2');
  });
});
