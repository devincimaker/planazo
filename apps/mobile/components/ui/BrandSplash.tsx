import { StyleSheet, View } from 'react-native';
import { BrandMark } from './BrandMark';
import { ThemedText } from './ThemedText';
import { colors, fonts, spacing } from '../../theme/tokens';

/**
 * The in-app twin of the native splash (design 1c). Booting shows this rather
 * than a bare spinner so the handoff from the launch screen is invisible —
 * same paper, same mark, same place on screen.
 */
export function BrandSplash() {
  return (
    <View style={styles.screen} testID="brand-splash">
      <BrandMark size={104} />
      <ThemedText style={styles.wordmark}>Planazo</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
    backgroundColor: colors.background,
  },
  wordmark: {
    fontFamily: fonts.displayHeavy,
    fontSize: 34,
    lineHeight: 38,
    letterSpacing: -0.72,
    color: colors.textPrimary,
  },
});
