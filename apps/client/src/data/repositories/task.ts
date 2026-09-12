import { z } from 'zod';
import type { LabelSummary } from './label';
import type { ProjectSummary } from './project';

export const taskPrioritySchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
export type TaskPriority = z.infer<typeof taskPrioritySchema>;

// Calendar dates and wall-clock times deliberately aren't UTC timestamps or deadlines.
export const taskInputSchema = z
  .object({
    title: z.string().trim().min(1, 'Give your task a name.'),
    description: z.string().trim().default(''),
    priority: taskPrioritySchema.default(4),
    scheduledDate: z.iso.date().nullable().default(null),
    scheduledTime: z.iso.time({ precision: -1 }).nullable().default(null),
  })
  .refine((task) => task.scheduledTime === null || task.scheduledDate !== null, {
    message: 'Choose a date before adding a time.',
    path: ['scheduledTime'],
  });

export type TaskInput = z.input<typeof taskInputSchema>;
export type Task = z.output<typeof taskInputSchema> & {
  id: string;
  createdAt: string;
  completedAt: string | null;
  labels: LabelSummary[];
  /** Stored membership. Inbox is null; a missing join must not rewrite this. */
  projectId: string | null;
  project: ProjectSummary | null;
};

/** Present on update only when the editor changed the label selection. */
export type TaskLabelEdit = {
  labelIds: readonly string[];
  baselineLabelIds: readonly string[];
};

/** Present on update only when the editor changed project membership. */
export type TaskProjectEdit = {
  projectId: string | null;
};

/**
 * Composer always sends the selection. The editor omits it when the selection
 * still matches the open-editor baseline, so a title-only save does not move
 * the task after a remote project change.
 */
export function projectIdForSubmit(
  selected: string | null,
  baseline: string | null,
  mode: 'always' | 'when-changed',
): string | null | undefined {
  if (mode === 'always' || selected !== baseline) return selected;
  return undefined;
}

export class TaskNotFoundError extends Error {
  readonly code = 'not-found' as const;

  constructor() {
    super('Task not found');
    this.name = 'TaskNotFoundError';
  }
}

export class TaskRestoreConflictError extends Error {
  readonly code = 'restore-conflict' as const;

  constructor() {
    super('A task with this id already exists');
    this.name = 'TaskRestoreConflictError';
  }
}
