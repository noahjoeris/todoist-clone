import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/**
 * Must match `LABEL_COLORS` in `packages/contracts`. Used only for the
 * `labels_color_allowed` check; the wire enum lives in contracts.
 */
const LABEL_COLORS = [
  'berry_red',
  'red',
  'orange',
  'yellow',
  'olive_green',
  'lime_green',
  'green',
  'mint_green',
  'teal',
  'sky_blue',
  'light_blue',
  'blue',
  'grape',
  'violet',
  'lavender',
  'magenta',
  'salmon',
  'charcoal',
  'grey',
  'taupe',
] as const;

/**
 * Raw SQL appended to the generated migration (drizzle-kit cannot model `auth`):
 *
 *   ALTER TABLE public.labels ADD CONSTRAINT labels_user_id_fk
 *     FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
 *   GRANT SELECT ON public.labels TO powersync_role;
 *   ALTER PUBLICATION powersync ADD TABLE public.labels;
 *
 * Regenerating `0000_*.sql` (pre-release replace-in-place) drops those
 * statements — re-append them.
 */
export const labels = pgTable(
  'labels',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    name: text('name').notNull(),
    color: text('color').notNull().default('charcoal'),
    isFavorite: boolean('is_favorite').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('labels_user_id_lower_name_idx').on(table.userId, sql`lower(${table.name})`),
    check(
      'labels_name_trimmed',
      sql`${table.name} = btrim(${table.name}) AND char_length(${table.name}) BETWEEN 1 AND 60`,
    ),
    check(
      'labels_color_allowed',
      sql`${table.color} IN (${sql.raw(LABEL_COLORS.map((color) => `'${color}'`).join(', '))})`,
    ),
  ],
).enableRLS();
