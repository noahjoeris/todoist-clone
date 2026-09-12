import type { HomePane } from './home-pane';

export type ComposerKind = 'closed' | 'global' | 'view' | 'group';

/** Sidebar Add task is always Inbox. View create inherits only an active project. */
export function defaultComposerProjectId(
  composerKind: ComposerKind,
  pane: HomePane,
): string | null {
  if (composerKind !== 'view') return null;
  if (pane.type === 'project') return pane.projectId;
  return null;
}

export function defaultComposerLabelIds(
  composerKind: ComposerKind,
  pane: HomePane,
): string[] | undefined {
  if (composerKind === 'view' && pane.type === 'label') return [pane.labelId];
  return undefined;
}
