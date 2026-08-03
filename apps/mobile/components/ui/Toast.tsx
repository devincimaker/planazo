import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedText } from './ThemedText';
import { MIN_TOUCH_TARGET } from '../../lib/a11y';
import { colors, palette, spacing } from '../../theme/tokens';

export interface ToastAction {
  label: string;
  onPress: () => void;
  testID?: string;
}

interface ToastOptions {
  /** A single reversal offered alongside the message, e.g. "Undo". */
  action?: ToastAction;
  /** How long the pill stays. Defaults to 2600ms. */
  durationMs?: number;
}

const DEFAULT_DURATION = 2600;

let notify: ((message: string, options?: ToastOptions) => void) | null = null;

/** Quiet confirmation (14c): dark pill below the header, gone on its own. */
export function showToast(message: string, options?: ToastOptions) {
  notify?.(message, options);
}

export function ToastHost() {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<{ message: string; action?: ToastAction } | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    notify = (message, options) => {
      setToast({ message, action: options?.action });
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setToast(null), options?.durationMs ?? DEFAULT_DURATION);
    };
    return () => {
      notify = null;
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!toast) return null;

  const action = toast.action;

  return (
    // box-none rather than none: the pill's own action has to be tappable,
    // while everything around it stays transparent to touches. A toast that
    // swallowed taps on the screen behind it would be worse than no toast.
    <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + 66 }]}>
      <Animated.View entering={FadeInDown} exiting={FadeOutUp} style={styles.pill} testID="toast">
        <View style={styles.dot} />
        <ThemedText variant="bodyStrong" color={colors.background} style={styles.text}>
          {toast.message}
        </ThemedText>
        {action ? (
          <Pressable
            onPress={() => {
              setToast(null);
              action.onPress();
            }}
            accessibilityRole="button"
            testID={action.testID ?? 'toast-action'}
            style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
          >
            <ThemedText variant="bodyStrong" color={colors.accent}>
              {action.label}
            </ThemedText>
          </Pressable>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
    zIndex: 100,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.ink,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.4,
    shadowRadius: 18,
    elevation: 8,
  },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 999,
    backgroundColor: palette.green,
  },
  text: {
    flexShrink: 1,
  },
  // The pill is 48 tall, so the word only needs to claim the full height and a
  // little either side to clear 44 without the padding showing.
  action: {
    justifyContent: 'center',
    alignSelf: 'stretch',
    minWidth: MIN_TOUCH_TARGET,
    alignItems: 'flex-end',
    marginVertical: -14,
    paddingVertical: 14,
  },
  actionPressed: {
    opacity: 0.6,
  },
});
