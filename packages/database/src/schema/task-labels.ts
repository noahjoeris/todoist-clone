import { index, pgTable, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { labels } from './labels.js';
import { tasks } from './tasks.js';

/**
 * Raw SQL appended to the generated migration (drizzle-kit cannot model `auth`):
 *
 *   ALTER TABLE public.task_labels ADD CONSTRAINT task_labels_user_id_fk
 *     FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
 *   GRANT SELECT ON public.task_labels TO powersync_role;
 *   ALTER PUBLICATION powersync ADD TABLE public.task_labels;
 *
 * Regenerating `0000_*.sql` (pre-release replace-in-place) drops those
 * statements — re-append them.
 */
export const taskLabels = pgTable(
  'task_labels',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    labelId: uuid('label_id')
      .notNull()
      .references(() => labels.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('task_labels_task_id_label_id_uidx').on(table.taskId, table.labelId),
    index('task_labels_user_id_idx').on(table.userId),
    index('task_labels_label_id_idx').on(table.labelId),
  ],
).enableRLS();
