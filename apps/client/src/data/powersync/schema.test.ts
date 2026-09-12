import { describe, expect, it } from 'vitest';
import { appSchema } from './schema';

describe('appSchema', () => {
  it('declares synced tasks alongside local-only guest tasks and preferences', () => {
    expect(appSchema.props.local_tasks.localOnly).toBe(true);
    expect(appSchema.props.local_preferences.localOnly).toBe(true);
    expect(appSchema.props.local_preferences.columns.map((column) => column.name)).toEqual([
      'value',
    ]);
    expect(appSchema.props.local_tasks.columns.map((column) => column.name)).toEqual([
      'title',
      'description',
      'priority',
      'scheduled_date',
      'scheduled_time',
      'completed_at',
      'created_at',
    ]);
    expect(appSchema.props.tasks.localOnly).toBe(false);
    expect(appSchema.props.tasks.columns.map((column) => column.name)).toEqual([
      'user_id',
      'title',
      'description',
      'priority',
      'scheduled_date',
      'scheduled_time',
      'completed_at',
      'created_at',
      'updated_at',
    ]);
    expect(appSchema.props.labels.localOnly).toBe(false);
    expect(appSchema.props.labels.columns.map((column) => column.name)).toEqual([
      'user_id',
      'name',
      'color',
      'is_favorite',
      'created_at',
      'updated_at',
    ]);
    expect(appSchema.props.task_labels.localOnly).toBe(false);
    expect(appSchema.props.task_labels.columns.map((column) => column.name)).toEqual([
      'user_id',
      'task_id',
      'label_id',
      'created_at',
    ]);
  });
});
