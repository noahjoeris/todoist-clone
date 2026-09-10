import { z } from 'zod';

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
export type Task = z.output<typeof taskInputSchema> & { id: string; createdAt: string };
