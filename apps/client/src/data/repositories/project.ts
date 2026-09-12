import {
  LABEL_COLORS,
  type LabelColor,
  labelColorSchema,
  normalizeSqliteBoolean,
} from '@todoist-clone/contracts';
import { z } from 'zod';
import { parseLabelColor } from './label';

export type { LabelColor };
export { LABEL_COLORS, parseLabelColor };

export const PROJECT_NAME_MAX = 60;
export const MAX_PROJECT_SORT_ORDER = 2_147_483_647;
export const MAX_UPLOAD_OPERATIONS = 2000;

export const projectNameSchema = z
  .string()
  .trim()
  .min(1, 'Give your project a name.')
  .max(PROJECT_NAME_MAX, 'Use 60 characters or fewer.');

export const projectInputSchema = z.object({
  name: projectNameSchema,
  color: labelColorSchema.default('charcoal'),
  isFavorite: z.boolean().default(false),
});

export type ProjectInput = z.input<typeof projectInputSchema>;
export type ProjectFields = z.output<typeof projectInputSchema>;

export type ProjectPatch = {
  name?: string;
  color?: LabelColor;
  isFavorite?: boolean;
};

export type ProjectSummary = {
  id: string;
  name: string;
  color: LabelColor;
  isArchived: boolean;
};

export type ProjectListItem = ProjectSummary & {
  isFavorite: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  activeTaskCount: number;
  totalTaskCount: number;
};

export class ProjectNotFoundError extends Error {
  readonly code = 'not-found' as const;

  constructor() {
    super('Project not found');
    this.name = 'ProjectNotFoundError';
  }
}

export class ProjectDuplicateNameError extends Error {
  readonly code = 'duplicate-name' as const;

  constructor() {
    super('A project with this name already exists');
    this.name = 'ProjectDuplicateNameError';
  }
}

export class ProjectStaleListError extends Error {
  readonly code = 'stale-list' as const;

  constructor() {
    super('Project list changed. Refresh and try again.');
    this.name = 'ProjectStaleListError';
  }
}

export class ProjectOperationTooLargeError extends Error {
  readonly code = 'operation-too-large' as const;

  constructor(message: string) {
    super(message);
    this.name = 'ProjectOperationTooLargeError';
  }
}

/** Case-insensitive fold; SQLite `lower()` is ASCII-only (ADR-019). */
export function foldProjectName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

export function projectNamesEqual(left: string, right: string): boolean {
  return foldProjectName(left) === foldProjectName(right);
}

export function readSqliteFlag(value: unknown): boolean {
  return normalizeSqliteBoolean(value) === true;
}

export function flagToSqlite(value: boolean): number {
  return value ? 1 : 0;
}

export function sortProjectsByOrder<T extends { sortOrder: number; id: string }>(
  projects: T[],
): T[] {
  return [...projects].sort((left, right) => {
    const byOrder = left.sortOrder - right.sortOrder;
    return byOrder !== 0 ? byOrder : left.id.localeCompare(right.id);
  });
}

export function activeProjects<T extends { isArchived: boolean }>(projects: readonly T[]): T[] {
  return projects.filter((project) => !project.isArchived);
}

export function archivedProjects<T extends { isArchived: boolean }>(projects: readonly T[]): T[] {
  return projects.filter((project) => project.isArchived);
}

export function favoriteProjects<T extends { isFavorite: boolean; isArchived: boolean }>(
  projects: readonly T[],
): T[] {
  return projects.filter((project) => project.isFavorite && !project.isArchived);
}

/**
 * Rebuild the full owned sequence: keep archived rows in their slots and
 * replace active slots with `activeIds` in the requested order.
 */
export function spliceActiveOrder<T extends { id: string; isArchived: boolean }>(
  canonical: readonly T[],
  activeIds: readonly string[],
): T[] {
  const byId = new Map(canonical.map((project) => [project.id, project]));
  const queue = [...activeIds];
  return canonical.map((project) => {
    if (project.isArchived) return project;
    const nextId = queue.shift();
    if (nextId === undefined) return project;
    return byId.get(nextId) ?? project;
  });
}
