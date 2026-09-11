import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Raw SQL appended to the generated migration (drizzle-kit cannot model `auth`):
 *
 *   ALTER TABLE public.tasks ADD CONSTRAINT tasks_user_id_fk
 *     FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
 *   GRANT SELECT ON public.tasks TO powersync_role;
 *   ALTER PUBLICATION powersync ADD TABLE public.tasks;
 *
 * Regenerating `0000_tasks.sql` (pre-release replace-in-place) drops those
 * statements — re-append them.
 */
export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    priority: smallint('priority').notNull().default(4),
    scheduledDate: date('scheduled_date', { mode: 'string' }),
    scheduledTime: time('scheduled_time', { precision: 0 }),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('tasks_user_id_created_at_idx').on(table.userId, table.createdAt.desc()),
    check('tasks_priority_range', sql`${table.priority} BETWEEN 1 AND 4`),
    check(
      'tasks_scheduled_time_requires_date',
      sql`${table.scheduledTime} IS NULL OR ${table.scheduledDate} IS NOT NULL`,
    ),
  ],
).enableRLS();
