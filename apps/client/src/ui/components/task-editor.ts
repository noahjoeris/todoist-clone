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
