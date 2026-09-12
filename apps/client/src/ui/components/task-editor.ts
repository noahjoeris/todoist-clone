/** Label ids on a task at a point in time. Capture once when the editor opens. */
export function labelIdsFromTask(task: { labels: readonly { id: string }[] } | null): string[] {
  return task?.labels.map((label) => label.id) ?? [];
}

/** Project membership at open. Inbox is null. */
export function projectIdFromTask(task: { projectId: string | null } | null): string | null {
  return task?.projectId ?? null;
}

/**
 * Keep the first captured baseline. Later live snapshots from sync must not
 * replace it, or a title-only save looks label-dirty (ADR-019).
 */
export function holdOpenEditorLabelIds(
  held: readonly string[] | undefined,
  liveTask: { labels: readonly { id: string }[] } | null,
): readonly string[] {
  return held ?? labelIdsFromTask(liveTask);
}

/**
 * Resolve the open editor's task from a by-id watch, not the current view list.
 * Leaving Inbox/label/project membership must not look like deletion; only a
 * by-id miss for this editing id is missing.
 */
export function resolveOpenEditorTask<T extends { id: string }>(input: {
  editingId: string | null;
  viewTask: T | null;
  watched: { id: string; task: T | null } | null;
  heldTask: T | null;
}): { task: T | null; missing: boolean; hold: T | null } {
  if (input.editingId == null) return { task: null, missing: false, hold: null };
  const watchMatches = input.watched?.id === input.editingId;
  const live = watchMatches ? (input.watched?.task ?? null) : input.viewTask;
  const task = live ?? input.heldTask;
  const missing = watchMatches && input.watched?.task == null;
  return { task, missing, hold: task };
}
