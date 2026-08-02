import { Text, TextProps } from 'react-native';
import { type } from '../../theme/tokens';

export type TextVariant = keyof typeof type;

interface ThemedTextProps extends TextProps {
  variant?: TextVariant;
  color?: string;
}

/**
 * How far each variant may follow the system text size.
 *
 * Body copy is deliberately absent: somebody who has asked for Accessibility
 * XXXL needs the words at that size, and capping the content is how you fail
 * the setting rather than support it. Display type is a different problem.
 * `screenTitle` is already 30pt, and at iOS's ~3.1x accessibility scale it
 * becomes a 90pt headline that fills the screen before a single field is
 * reachable. These caps keep big type big without letting one heading push
 * the form out of the viewport.
 */
const MAX_SCALE: Partial<Record<TextVariant, number>> = {
  screenTitle: 1.6,
  headerTitle: 1.6,
  cardTitle: 1.7,
  statusHeadline: 1.7,
};

export function ThemedText({ variant = 'body', color, style, ...rest }: ThemedTextProps) {
  return (
    <Text
      maxFontSizeMultiplier={MAX_SCALE[variant]}
      style={[type[variant], color ? { color } : null, style]}
      {...rest}
    />
  );
}
