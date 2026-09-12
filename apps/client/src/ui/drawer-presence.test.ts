import { describe, expect, it } from 'vitest';
import {
  closedDrawer,
  finishDrawerClose,
  layoutModeForWidth,
  releaseDrawerHost,
  requestDrawerClose,
  requestDrawerOpen,
  SIDEBAR_BREAKPOINT,
} from './drawer-presence';

describe('drawer presence', () => {
  it('keeps the host mounted through close and ignores a cancelled close after reopen', () => {
    let state = requestDrawerOpen(closedDrawer);
    expect(state).toMatchObject({ open: true, visible: true, generation: 1 });

    state = requestDrawerClose(state);
    expect(state).toMatchObject({ open: false, visible: true, generation: 1 });

    const closingGeneration = state.generation;
    state = requestDrawerOpen(state);
    expect(state).toMatchObject({ open: true, visible: true, generation: 2 });

    state = finishDrawerClose(state, closingGeneration);
    expect(state).toMatchObject({ open: true, visible: true, generation: 2 });

    state = requestDrawerClose(state);
    state = finishDrawerClose(state, state.generation);
    expect(state).toMatchObject({ open: false, visible: false, generation: 2 });
  });

  it('opens with visible+open together so a remounted host must animate from closed', () => {
    // AppShell mounts NavigationDrawer when presence.visible; requestDrawerOpen
    // sets both flags. Seeding Reanimated progress from presence.open would skip
    // the entrance animation — the drawer host must start progress at 0.
    const state = requestDrawerOpen(closedDrawer);
    expect(state.open).toBe(true);
    expect(state.visible).toBe(true);
  });

  it('releases the host immediately on breakpoint or identity reset and ignores the stale close', () => {
    let state = requestDrawerOpen(closedDrawer);
    state = requestDrawerClose(state);
    const closingGeneration = state.generation;

    state = releaseDrawerHost(state);
    expect(state).toMatchObject({ open: false, visible: false, generation: closingGeneration + 1 });

    state = finishDrawerClose(state, closingGeneration);
    expect(state.visible).toBe(false);
    expect(state.open).toBe(false);

    expect(layoutModeForWidth(SIDEBAR_BREAKPOINT - 1)).toBe('overlay');
    expect(layoutModeForWidth(SIDEBAR_BREAKPOINT)).toBe('persistent');
  });
});
