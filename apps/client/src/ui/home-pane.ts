import type { TaskDestination } from '../data/repositories';

export type HomePane =
  | { type: 'inbox' }
  | { type: 'today' }
  | { type: 'upcoming' }
  | { type: 'label'; labelId: string }
  | { type: 'labels' };

export function isSamePane(left: HomePane, right: HomePane): boolean {
  if (left.type !== right.type) return false;
  if (left.type === 'label' && right.type === 'label') return left.labelId === right.labelId;
  return true;
}

export function taskDestinationOf(pane: HomePane): TaskDestination | null {
  if (pane.type === 'inbox' || pane.type === 'today' || pane.type === 'upcoming') return pane.type;
  return null;
}
