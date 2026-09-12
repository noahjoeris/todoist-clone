import { describe, expect, it } from 'vitest';
import { isUniqueViolation, LABELS_NAME_UNIQUE, TASK_LABELS_PAIR_UNIQUE } from './errors.js';

describe('isUniqueViolation', () => {
  it('matches a postgres-js unique violation by constraint_name', () => {
    const error = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint_name: LABELS_NAME_UNIQUE,
    });
    expect(isUniqueViolation(error, LABELS_NAME_UNIQUE)).toBe(true);
    expect(isUniqueViolation(error, TASK_LABELS_PAIR_UNIQUE)).toBe(false);
  });

  it('walks error.cause when drizzle wraps the driver error', () => {
    const cause = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: TASK_LABELS_PAIR_UNIQUE,
    });
    const error = new Error('Failed query', { cause });
    expect(isUniqueViolation(error, TASK_LABELS_PAIR_UNIQUE)).toBe(true);
  });

  it('rejects other postgres errors', () => {
    const error = Object.assign(new Error('fk'), {
      code: '23503',
      constraint_name: TASK_LABELS_PAIR_UNIQUE,
    });
    expect(isUniqueViolation(error, TASK_LABELS_PAIR_UNIQUE)).toBe(false);
  });
});
