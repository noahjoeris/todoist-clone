import type { LabelSummary } from '../data/repositories';

export function filterLabelsByQuery<T extends LabelSummary>(labels: T[], query: string): T[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === '') return labels;
  return labels.filter((label) => label.name.toLocaleLowerCase().includes(needle));
}

export function hasExactName(
  labels: readonly Pick<LabelSummary, 'name'>[],
  query: string,
): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === '') return false;
  return labels.some((label) => label.name.toLocaleLowerCase() === needle);
}

/** Inline create is offered when the trimmed query is a valid unused name. */
export function inlineCreateName(
  query: string,
  labels: readonly Pick<LabelSummary, 'name'>[],
): string | null {
  const name = query.trim();
  if (name.length < 1 || name.length > 60) return null;
  if (hasExactName(labels, name)) return null;
  return name;
}
