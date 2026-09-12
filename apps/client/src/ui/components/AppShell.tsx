import { type ReactNode, type RefObject, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import type { DrawerPresence, LayoutMode } from '../drawer-presence';
import { colors } from '../theme';
import { NavigationDrawer } from './NavigationDrawer';

interface AppShellProps {
  layoutMode: LayoutMode;
  presence: DrawerPresence;
  sidebar: ReactNode;
  children: ReactNode;
  onCloseDrawer: () => void;
  onCloseFinished: (generation: number) => void;
  menuButtonRef: RefObject<View | null>;
  restoreFocus?: () => void;
}

export function AppShell({
  layoutMode,
  presence,
  sidebar,
  children,
  onCloseDrawer,
  onCloseFinished,
  menuButtonRef,
  restoreFocus: restoreFocusOverride,
}: AppShellProps) {
  const restoreFocus = useCallback(() => {
    if (restoreFocusOverride) {
      restoreFocusOverride();
      return;
    }
    const node = menuButtonRef.current as (View & { focus?: () => void }) | null;
    node?.focus?.();
  }, [menuButtonRef, restoreFocusOverride]);

  return (
    <View style={styles.shell}>
      {layoutMode === 'persistent' && <View style={styles.sidebarColumn}>{sidebar}</View>}
      <View
        style={styles.pane}
        importantForAccessibility={presence.visible ? 'no-hide-descendants' : 'auto'}
        pointerEvents={presence.visible ? 'none' : 'auto'}
      >
        {children}
      </View>
      {layoutMode === 'overlay' && presence.visible && (
        <NavigationDrawer
          presence={presence}
          onClose={onCloseDrawer}
          onCloseFinished={onCloseFinished}
          restoreFocus={restoreFocus}
        >
          {sidebar}
        </NavigationDrawer>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, flexDirection: 'row', backgroundColor: colors.background },
  sidebarColumn: {
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  pane: { flex: 1, minWidth: 0 },
});
