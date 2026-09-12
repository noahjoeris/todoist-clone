import { type ReactNode, useCallback, useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  BackHandler,
  I18nManager,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import {
  DRAWER_CLOSE_MS,
  DRAWER_OPEN_MS,
  type DrawerPresence,
  SIDEBAR_WIDTH,
} from '../drawer-presence';
import { colors } from '../theme';

interface NavigationDrawerProps {
  presence: DrawerPresence;
  onClose: () => void;
  onCloseFinished: (generation: number) => void;
  restoreFocus: () => void;
  children: ReactNode;
}

export function NavigationDrawer({
  presence,
  onClose,
  onCloseFinished,
  restoreFocus,
  children,
}: NavigationDrawerProps) {
  // Always start closed: host mounts with presence.open already true, so seeding
  // progress at 1 would skip the open slide/backdrop (AC9).
  const progress = useSharedValue(0);
  const [drawerWidth, setDrawerWidth] = useState(SIDEBAR_WIDTH);
  const reducedMotion = usePrefersReducedMotion();
  const hiddenDirection = I18nManager.isRTL ? 1 : -1;

  const handleAnimationComplete = useCallback(
    (generation: number, finished: boolean, closing: boolean) => {
      if (!finished || !closing) return;
      restoreFocus();
      onCloseFinished(generation);
    },
    [onCloseFinished, restoreFocus],
  );

  useEffect(() => {
    const generation = presence.generation;
    const closing = !presence.open;
    progress.value = withTiming(
      presence.open ? 1 : 0,
      {
        duration: reducedMotion ? 0 : presence.open ? DRAWER_OPEN_MS : DRAWER_CLOSE_MS,
        easing: Easing.out(Easing.cubic),
        reduceMotion: ReduceMotion.System,
      },
      (finished) => {
        scheduleOnRN(handleAnimationComplete, generation, finished === true, closing);
      },
    );
    return () => {
      cancelAnimation(progress);
    };
  }, [presence.open, presence.generation, handleAnimationComplete, progress, reducedMotion]);

  useEffect(() => {
    if (!reducedMotion || presence.open || !presence.visible) return;
    restoreFocus();
    onCloseFinished(presence.generation);
  }, [
    reducedMotion,
    presence.open,
    presence.visible,
    presence.generation,
    restoreFocus,
    onCloseFinished,
  ]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [onClose]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const drawerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (1 - progress.value) * hiddenDirection * drawerWidth }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.value * 0.5,
  }));

  return (
    <Modal
      transparent
      animationType="none"
      visible
      onRequestClose={onClose}
      statusBarTranslucent
      accessibilityViewIsModal
    >
      <View style={styles.host} pointerEvents="box-none">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss navigation"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        >
          <Animated.View style={[styles.backdrop, backdropStyle]} pointerEvents="none" />
        </Pressable>
        <Animated.View
          accessibilityRole="menu"
          accessibilityLabel="Navigation"
          onLayout={(event) => {
            const width = event.nativeEvent.layout.width;
            if (width > 0) setDrawerWidth(width);
          }}
          style={[
            styles.drawer,
            I18nManager.isRTL ? styles.drawerRtl : styles.drawerLtr,
            drawerStyle,
          ]}
        >
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

function usePrefersReducedMotion(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (!cancelled) setEnabled(value);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setEnabled);
    const media =
      Platform.OS === 'web' && typeof window !== 'undefined'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    const onMedia = (event: MediaQueryListEvent) => setEnabled(event.matches);
    if (media) {
      setEnabled(media.matches);
      media.addEventListener('change', onMedia);
    }
    return () => {
      cancelled = true;
      subscription.remove();
      media?.removeEventListener('change', onMedia);
    };
  }, []);
  return enabled;
}

const styles = StyleSheet.create({
  host: { flex: 1 },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#000000',
  },
  drawer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: SIDEBAR_WIDTH,
    backgroundColor: colors.surface,
  },
  drawerLtr: { left: 0 },
  drawerRtl: { right: 0 },
});
