import { View, StyleSheet, ViewProps } from 'react-native';
import { colors, radii, spacing } from '../../theme/tokens';

interface CardProps extends ViewProps {
  /** 4px identity stripe across the top (group color) */
  stripeColor?: string;
  /** Remove default padding when the content manages its own */
  padded?: boolean;
}

export function Card({ stripeColor, padded = true, style, children, ...rest }: CardProps) {
  return (
    <View style={[styles.card, style]} {...rest}>
      {stripeColor ? <View style={[styles.stripe, { backgroundColor: stripeColor }]} /> : null}
      <View style={padded ? styles.content : null}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  stripe: {
    height: 4,
  },
  content: {
    padding: spacing.lg,
  },
});
