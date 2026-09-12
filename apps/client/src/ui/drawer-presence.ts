export const SIDEBAR_BREAKPOINT = 900;
export const SIDEBAR_WIDTH = 260;
export const DRAWER_OPEN_MS = 220;
export const DRAWER_CLOSE_MS = 180;

export type LayoutMode = 'persistent' | 'overlay';

export function layoutModeForWidth(width: number): LayoutMode {
  return width >= SIDEBAR_BREAKPOINT ? 'persistent' : 'overlay';
}

/**
 * Requested open state is separate from host presence so a close animation can
 * finish before unmount, and a reopen can cancel a stale close.
 */
export type DrawerPresence = {
  open: boolean;
  visible: boolean;
  generation: number;
};

export const closedDrawer: DrawerPresence = {
  open: false,
  visible: false,
  generation: 0,
};

export function requestDrawerOpen(state: DrawerPresence): DrawerPresence {
  if (state.open && state.visible) return state;
  return { open: true, visible: true, generation: state.generation + 1 };
}

export function requestDrawerClose(state: DrawerPresence): DrawerPresence {
  if (!state.open) return state;
  return { ...state, open: false };
}

export function finishDrawerClose(state: DrawerPresence, generation: number): DrawerPresence {
  if (generation !== state.generation || state.open || !state.visible) return state;
  return { ...state, visible: false };
}

/** Immediate teardown: persistent layout, account change, or unmount. */
export function releaseDrawerHost(state: DrawerPresence): DrawerPresence {
  if (!state.open && !state.visible) {
    return { ...state, generation: state.generation + 1 };
  }
  return { open: false, visible: false, generation: state.generation + 1 };
}
