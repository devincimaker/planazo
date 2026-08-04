import { ReactNode, useCallback, useEffect, useRef } from 'react';
import { Animated, Easing, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { ThemedText } from './ThemedText';
import { colors } from '../../theme/tokens';

export interface SwipeAction {
  /** Stable id, also the name VoiceOver's rotor reports. */
  key: string;
  label: string;
  background: string;
  foreground: string;
  icon: ReactNode;
  onPress: () => void;
  testID?: string;
}

interface SwipeRowProps {
  actions: SwipeAction[];
  /** Controlled by the list so only one row is ever open. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Nudge the row open and shut once, to announce the actions exist. */
  peek?: boolean;
  /**
   * What the row is about, and what stays put while it slides.
   */
  children: ReactNode;
  /**
   * Anything on the right that should slide away *with* the row rather than
   * hold its place — a status chip, a chevron, a value.
   *
   * It needs its own slot because `children` counter-translates: content that
   * starts near the right edge and refuses to move ends up sitting on top of
   * the actions it just revealed, covering the very buttons the swipe exists
   * to offer. Only what starts on the left can afford to stay.
   */
  trailing?: ReactNode;
  testID?: string;
}

/** Each action is a 80pt column, the same square-ish block iOS Mail uses. */
export const ACTION_WIDTH = 80;
/** Past this much drag the row snaps open rather than back. */
const OPEN_AT = 70;
/** Below this the gesture is a tap or a scroll, not a swipe. */
const AXIS_SLOP = 5;
const SNAP_MS = 200;

/**
 * A row that slides left to reveal actions underneath it.
 *
 * Built on PanResponder and Animated from React Native itself rather than
 * `react-native-gesture-handler`, which this app does not have: adding it is a
 * native dependency, and the `ios` folder is gitignored, so every checkout
 * would need a rebuild to open one screen.
 *
 * Two details are load-bearing rather than decorative:
 *
 * - **The person does not move.** The white row slides, but the avatar and
 *   name counter-translate by the same amount, so the face you are about to
 *   remove stays under your thumb the whole way.
 * - **There is no full-swipe shortcut.** Dragging past the end does nothing;
 *   removing somebody is always a deliberate second tap. Swipe-to-commit is
 *   right for archiving mail and wrong for throwing a person out of a group.
 */
export function SwipeRow({
  actions,
  open,
  onOpenChange,
  peek = false,
  children,
  trailing,
  testID,
}: SwipeRowProps) {
  const rest = -ACTION_WIDTH * actions.length;
  const translateX = useRef(new Animated.Value(0)).current;
  // Where the row sits when nobody is dragging it. The Animated.Value is the
  // live position; this is the one the next gesture starts from.
  const resting = useRef(0);
  const openRef = useRef(open);
  openRef.current = open;
  // PanResponder is built once, so anything it calls has to be read through a
  // ref or it stays pinned to the first render's closure.
  const notifyRef = useRef(onOpenChange);
  notifyRef.current = onOpenChange;
  const touched = useRef(false);

  // Stable: it only touches refs, so the effects below can depend on it
  // honestly instead of omitting it and hoping.
  const snapTo = useCallback(
    (to: number) => {
      resting.current = to;
      Animated.timing(translateX, {
        toValue: to,
        duration: SNAP_MS,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start();
    },
    [translateX]
  );

  // The list closed us because another row opened, or an action fired.
  useEffect(() => {
    if (!open && resting.current !== 0) snapTo(0);
  }, [open, snapTo]);

  useEffect(() => {
    if (!peek) return;
    // 34pt is enough to show colour and motion without reading as "open".
    // Both steps stand down the moment a real finger arrives: a demo that
    // yanks the row shut under someone mid-swipe is worse than no demo.
    const out = setTimeout(() => {
      if (!touched.current) snapTo(-34);
    }, 600);
    const back = setTimeout(() => {
      if (!touched.current) snapTo(0);
    }, 1450);
    return () => {
      clearTimeout(out);
      clearTimeout(back);
    };
  }, [peek, snapTo]);

  const pan = useRef(
    PanResponder.create({
      // Never claim the touch on press: taps belong to whatever is inside.
      onStartShouldSetPanResponder: () => false,
      // Horizontal only, so the ScrollView keeps every vertical drag.
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(g.dx) > AXIS_SLOP && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: (_e, g) => {
        touched.current = true;
        const next = Math.max(rest, Math.min(0, resting.current + g.dx));
        translateX.setValue(next);
      },
      onPanResponderRelease: (_e, g) => {
        const landed = Math.max(rest, Math.min(0, resting.current + g.dx));
        const shouldOpen = landed <= -OPEN_AT;
        snapTo(shouldOpen ? rest : 0);
        if (shouldOpen !== openRef.current) {
          if (shouldOpen) Haptics.selectionAsync().catch(() => {});
          notifyRef.current(shouldOpen);
        }
      },
      onPanResponderTerminate: () => {
        snapTo(openRef.current ? rest : 0);
      },
    })
  ).current;

  return (
    <View style={styles.clip} testID={testID}>
      <View
        style={styles.actions}
        // Closed, the buttons are behind an opaque row; letting VoiceOver walk
        // into them would be walking into something nobody can see. The row
        // itself carries the same actions as accessibilityActions instead.
        importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
        accessibilityElementsHidden={!open}
      >
        {actions.map((action) => (
          <Pressable
            key={action.key}
            onPress={action.onPress}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            testID={action.testID}
            style={({ pressed }) => [
              styles.action,
              { backgroundColor: action.background },
              pressed && styles.actionPressed,
            ]}
          >
            {action.icon}
            <ThemedText variant="tag" color={action.foreground}>
              {action.label}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      <Animated.View
        {...pan.panHandlers}
        style={[styles.content, { transform: [{ translateX }] }]}
        testID={testID ? `${testID}-row` : undefined}
        accessible
        accessibilityActions={actions.map((a) => ({ name: a.key, label: a.label }))}
        onAccessibilityAction={(event) => {
          const match = actions.find((a) => a.key === event.nativeEvent.actionName);
          match?.onPress();
        }}
      >
        {/* The person rides against the slide so they stay put. */}
        <Animated.View
          style={[
            styles.rider,
            { transform: [{ translateX: Animated.multiply(translateX, -1) }] },
          ]}
        >
          {children}
        </Animated.View>
        {/* Trailing content slides, and the person it is beside does not, so
            left alone it would end up parked across their name. It dissolves
            instead: by 40pt of travel the chip is gone and the actions have
            the right-hand side to themselves. */}
        {trailing ? (
          <Animated.View
            style={{
              opacity: translateX.interpolate({
                inputRange: [-40, 0],
                outputRange: [0, 1],
                extrapolate: 'clamp',
              }),
            }}
          >
            {trailing}
          </Animated.View>
        ) : null}
        <Animated.Text
          style={[
            styles.hint,
            {
              opacity: translateX.interpolate({
                inputRange: [-8, 0],
                outputRange: [0, 1],
                extrapolate: 'clamp',
              }),
            },
          ]}
        >
          ‹
        </Animated.Text>

        {/* Open, a tap on the person shuts the row rather than hitting what is
            under it — the role chip especially, which would otherwise promote
            somebody on the way to closing a swipe.

            It lives inside the sliding layer on purpose. As a sibling of it,
            an absolutely-filled scrim would also cover the two action buttons
            it has just revealed, and every tap on Remove would land here
            instead. Riding with the content, it covers exactly the part of the
            row still showing the person. */}
        {open ? (
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => onOpenChange(false)}
            accessibilityRole="button"
            accessibilityLabel="Close actions"
            testID={testID ? `${testID}-scrim` : undefined}
          />
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: {
    overflow: 'hidden',
    position: 'relative',
  },
  actions: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  action: {
    width: ACTION_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  actionPressed: {
    opacity: 0.85,
  },
  content: {
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    // The rider counter-translates, so with the row open it overhangs the
    // content's frame by exactly the action area. Unclipped, that overhang is
    // an invisible layer over Block and Remove that swallows every real tap
    // (jest never sees this: pressing by testID skips hit-testing). Clipping
    // costs nothing visually. The overhang is the hint and trailing chip,
    // both already faded out by this point in the slide.
    overflow: 'hidden',
  },
  rider: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  hint: {
    flex: 0,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textFaint,
    paddingRight: 16,
  },
});
