import { View, StyleSheet, type ViewStyle } from 'react-native';
import { Button, type ButtonProps, type ButtonSize } from './Button';

/** Everything a Button takes except the two things the row itself decides. */
type Action = Omit<ButtonProps, 'size' | 'style' | 'numberOfLines'>;

interface ButtonRowProps {
  /** The way out, on the left: hugs its own label and never truncates it. */
  secondary: Action;
  /** What the row is actually for: takes the width the secondary doesn't need. */
  primary: Action;
  size?: ButtonSize;
  style?: ViewStyle;
  testID?: string;
}

/**
 * The escape hatch next to the action — "None of them" / "Send 3 dates",
 * "Can't make it" / "I'm in".
 *
 * Every one of these rows used to pin the secondary to a hand-measured pixel
 * `flexBasis`, which is a guess about how wide a label renders. The guess was
 * wrong for "None of them" at the default text size (PLA-22), and wrong for all
 * of them at accessibility text sizes. So no pixel width survives here: the
 * secondary's basis stays `auto`, meaning its base size *is* its own measured
 * label, whatever the string, font or text size.
 *
 * `flexWrap` is what makes it safe when they no longer fit: the primary drops
 * onto its own line and both go full width, so the words wrap instead of being
 * cut. A lone button on a wrapped line fills that line whatever its grow factor
 * — which is why the secondary needs a non-zero grow too, and why the primary's
 * is large rather than 1: on a single line the slack should nearly all go to
 * the primary, leaving the secondary hugging its label.
 *
 * The primary asking for half the row is what decides *when* they stack: they
 * split only once the way out wants more than the other half, which is a
 * proportion rather than a pixel and so holds at any text size or screen width.
 * Asking for its own label instead would stack the row for a long primary label
 * that fits perfectly well beside a short one — the plan-detail picker prompt
 * ("Tap the dates you can do" next to "None of them") does exactly that.
 */
export function ButtonRow({ secondary, primary, size = 'lg', style, testID }: ButtonRowProps) {
  return (
    <View style={[styles.row, style]} testID={testID}>
      <Button {...secondary} size={size} style={styles.secondary} numberOfLines={2} />
      <Button {...primary} size={size} style={styles.primary} numberOfLines={2} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  secondary: {
    flexGrow: 1,
    flexShrink: 1,
  },
  primary: {
    flexGrow: 999,
    flexShrink: 1,
    flexBasis: '50%',
  },
});
