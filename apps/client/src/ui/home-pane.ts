import type { TaskDestination } from '../data/repositories';

export type HomePane =
  | { type: 'inbox' }
  | { type: 'today' }
  | { type: 'upcoming' }
  | { type: 'label'; labelId: string }
  | { type: 'labels' }
  | { type: 'project'; projectId: string }
  | { type: 'projects' };

export function isSamePane(left: HomePane, right: HomePane): boolean {
  if (left.type !== right.type) return false;
  if (left.type === 'label' && right.type === 'label') return left.labelId === right.labelId;
  if (left.type === 'project' && right.type === 'project') {
    return left.projectId === right.projectId;
  }
  return true;
}

export function taskDestinationOf(pane: HomePane): TaskDestination | null {
  if (pane.type === 'inbox' || pane.type === 'today' || pane.type === 'upcoming') return pane.type;
  return null;
}

export function isTaskListPane(pane: HomePane): boolean {
  return pane.type !== 'labels' && pane.type !== 'projects';
}
