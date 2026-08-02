import { StyleSheet, View, ViewStyle } from 'react-native';
import { ThemedText } from './ThemedText';
import { colors, fonts } from '../../theme/tokens';

interface BrandMarkProps {
  size?: number;
  /** Paper tile with an ember P — for use on ember backgrounds */
  inverted?: boolean;
  style?: ViewStyle;
}

/**
 * The Planazo mark: a P in Bricolage 800, paper on ember. There is no
 * illustration in Planazo, so this is the whole brand — the tile crops the
 * bowl of the P rather than the glyph, which is what keeps the counter open
 * all the way down to 60 pt.
 *
 * Ratios are taken from the design doc at 52 pt and hold at every size.
 */
export function BrandMark({ size = 52, inverted = false, style }: BrandMarkProps) {
  return (
    <View
      accessibilityLabel="Planazo"
      style={[
        styles.tile,
        {
          width: size,
          height: size,
          borderRadius: size * 0.327,
          backgroundColor: inverted ? colors.background : colors.accent,
        },
        style,
      ]}
    >
      <ThemedText
        color={inverted ? colors.accent : colors.background}
        style={{
          fontFamily: fonts.displayHeavy,
          fontSize: size * 0.77,
          lineHeight: size * 0.77,
          letterSpacing: size * -0.038,
          transform: [{ translateY: size * 0.019 }],
        }}
      >
        P
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
