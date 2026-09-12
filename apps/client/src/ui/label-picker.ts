import { foldLabelName, type LabelSummary, labelNamesEqual } from '../data/repositories';

export function filterLabelsByQuery<T extends LabelSummary>(labels: T[], query: string): T[] {
  const needle = foldLabelName(query);
  if (needle === '') return labels;
  return labels.filter((label) => foldLabelName(label.name).includes(needle));
}

export function hasExactName(
  labels: readonly Pick<LabelSummary, 'name'>[],
  query: string,
): boolean {
  if (foldLabelName(query) === '') return false;
  return labels.some((label) => labelNamesEqual(label.name, query));
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
