/** Unique ids, preserving first-seen order. */
export function uniqueIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  return unique;
}

export function sameIdSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const set = new Set(left);
  return right.every((id) => set.has(id));
}

/**
 * Three-way merge for task↔label links.
 *
 * Attach anything the editor selected that is not on the task now.
 * Detach only labels the user removed that are still present and were in the
 * baseline — a title-only save omits this merge, and a remote add not in the
 * baseline is left alone.
 */
export function diffLabelAssociations(
  baseline: readonly string[],
  current: readonly string[],
  selected: readonly string[],
): { attach: string[]; detach: string[] } {
  const baselineSet = new Set(baseline);
  const currentSet = new Set(current);
  const selectedSet = new Set(selected);
  const attach: string[] = [];
  const detach: string[] = [];

  for (const id of selectedSet) {
    if (!currentSet.has(id)) attach.push(id);
  }
  for (const id of currentSet) {
    if (baselineSet.has(id) && !selectedSet.has(id)) detach.push(id);
  }
  return { attach, detach };
}
