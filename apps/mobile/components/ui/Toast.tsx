import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedText } from './ThemedText';
import { colors, palette, spacing } from '../../theme/tokens';

let notify: ((message: string) => void) | null = null;

/** Quiet confirmation (14c): dark pill below the header, gone on its own. */
export function showToast(message: string) {
  notify?.(message);
}

export function ToastHost() {
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    notify = (msg) => {
      setMessage(msg);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setMessage(null), 2600);
    };
    return () => {
      notify = null;
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!message) return null;

  return (
    <View pointerEvents="none" style={[styles.wrap, { top: insets.top + 66 }]}>
      <Animated.View entering={FadeInDown} exiting={FadeOutUp} style={styles.pill} testID="toast">
        <View style={styles.dot} />
        <ThemedText variant="bodyStrong" color={colors.background} style={styles.text}>
          {message}
        </ThemedText>
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
});
