import {
  LABEL_COLORS,
  type LabelColor,
  labelColorSchema,
  normalizeSqliteBoolean,
} from '@todoist-clone/contracts';
import { z } from 'zod';

export type { LabelColor };
export { LABEL_COLORS };

export const labelNameSchema = z
  .string()
  .trim()
  .min(1, 'Give your label a name.')
  .max(60, 'Use 60 characters or fewer.');

export const labelInputSchema = z.object({
  name: labelNameSchema,
  color: labelColorSchema.default('charcoal'),
  isFavorite: z.boolean().default(false),
});

export type LabelInput = z.input<typeof labelInputSchema>;
export type LabelFields = z.output<typeof labelInputSchema>;

export type LabelPatch = {
  name?: string;
  color?: LabelColor;
  isFavorite?: boolean;
};

export type LabelSummary = {
  id: string;
  name: string;
  color: LabelColor;
};

export type LabelListItem = LabelSummary & {
  isFavorite: boolean;
  createdAt: string;
  activeTaskCount: number;
};

export class LabelNotFoundError extends Error {
  readonly code = 'not-found' as const;

  constructor() {
    super('Label not found');
    this.name = 'LabelNotFoundError';
  }
}

export class LabelDuplicateNameError extends Error {
  readonly code = 'duplicate-name' as const;

  constructor() {
    super('A label with this name already exists');
    this.name = 'LabelDuplicateNameError';
  }
}

const COLOR_SET: ReadonlySet<string> = new Set(LABEL_COLORS);

/** Unknown stored colors fall back to charcoal so chips still render. */
export function parseLabelColor(value: string): LabelColor {
  if (COLOR_SET.has(value)) return value as LabelColor;
  return 'charcoal';
}

export function readSqliteFavorite(value: unknown): boolean {
  return normalizeSqliteBoolean(value) === true;
}

export function sortLabelsByName<T extends { name: string; id: string }>(labels: T[]): T[] {
  return [...labels].sort((left, right) => {
    const byName = left.name.localeCompare(right.name, undefined, { sensitivity: 'accent' });
    return byName !== 0 ? byName : left.id.localeCompare(right.id);
  });
}

/** Case-insensitive fold; SQLite `lower()` is ASCII-only (ADR-019). */
export function foldLabelName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

export function labelNamesEqual(left: string, right: string): boolean {
  return foldLabelName(left) === foldLabelName(right);
}
