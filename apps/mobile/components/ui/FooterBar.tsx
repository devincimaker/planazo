import { useContext, type ReactNode } from 'react';
import { View, StyleSheet, type LayoutChangeEvent } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { colors, spacing } from '../../theme/tokens';

type Props = {
  /** Sit at `bottom: 0` of the screen instead of at the end of the layout. */
  pinned?: boolean;
  /**
   * Clear the home indicator from inside the bar. Implied by `pinned`, and
   * needed on its own when the bar is in flow but the screen's `SafeAreaView`
   * carries no `bottom` edge.
   */
  insetBottom?: boolean;
  testID?: string;
  onLayout?: (event: LayoutChangeEvent) => void;
  children: ReactNode;
};

/**
 * The action bar six screens share: tab-bar chrome, a hairline top border, and
 * room for one or two stacked actions. The contents differ every time; only the
 * bar around them repeats (PLA-73).
 *
 * The bottom padding is why this is a component and not a style export. Whoever
 * clears the home indicator must do it exactly once. A bar inside a
 * `bottom`-edge `SafeAreaView` has already been inset by its parent and adds
 * nothing; a bar outside one adds the inset itself. Four screens used to
 * hardcode that second case as a flat 30 — 4pt short of the indicator on a
 * notched iPhone, and 30pt of dead space on a phone without one.
 */
export function FooterBar({ pinned, insetBottom, testID, onLayout, children }: Props) {
  // The context rather than useSafeAreaInsets(), which throws outright when no
  // SafeAreaProvider is above it. A bar that cannot render without a provider
  // is a worse primitive than one that falls back to its own padding.
  const insets = useContext(SafeAreaInsetsContext);
  const clearsIndicator = pinned || insetBottom;

  return (
    <View
      style={[
        styles.bar,
        pinned && styles.pinned,
        clearsIndicator && { paddingBottom: Math.max(insets?.bottom ?? 0, spacing.lg) },
      ]}
      onLayout={onLayout}
      testID={testID}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.tabBarBackground,
    borderTopWidth: 1,
    borderTopColor: colors.tabBarBorder,
    paddingHorizontal: spacing.xl,
    paddingTop: 14,
    paddingBottom: spacing.lg,
    // A no-op for the single-action bars, so it costs them nothing to share it.
    gap: spacing.md,
  },
  pinned: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
});
