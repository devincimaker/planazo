import { View, StyleSheet, Image } from 'react-native';
import { ThemedText } from './ThemedText';
import { colors, fonts } from '../../theme/tokens';
import { colorForName } from './Avatar';

/** First letter of the group's real name — leading articles don't get the tile. */
export function groupInitial(name: string): string {
  const words = name
    .replace(/^(La |Los |El |Las )/, '')
    .split(' ')
    .filter((w) => w.length > 2);
  return (words[0] ?? name).charAt(0).toUpperCase() || '?';
}

interface GroupTileProps {
  name: string;
  /** Stored group colour; falls back to the name hash for pre-colour rows */
  color?: string | null;
  /** PLA-30 group photo; the letter on the colour is the fallback */
  imageUrl?: string | null;
  size?: number;
  testID?: string;
}

/** Squarish colour tile that is the group's identity everywhere (6a–6e). */
export function GroupTile({ name, color, imageUrl, size = 46, testID }: GroupTileProps) {
  const radius = Math.round(size * 0.32);
  return (
    <View
      testID={testID}
      style={[
        styles.tile,
        {
          width: size,
          height: size,
          borderRadius: radius,
          // A photo covers the tile edge to edge, so the colour behind it would
          // only ever show through a transparent PNG. Keep it out of the way.
          backgroundColor: imageUrl ? 'transparent' : color ?? colorForName(name),
        },
      ]}
    >
      {imageUrl ? (
        <Image
          testID={testID ? `${testID}-image` : undefined}
          source={{ uri: imageUrl }}
          style={{ width: size, height: size, borderRadius: radius }}
        />
      ) : (
        <ThemedText style={[styles.initial, { fontSize: Math.round(size * 0.44) }]}>
          {groupInitial(name)}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  initial: {
    fontFamily: fonts.displayHeavy,
    color: colors.ink,
    lineHeight: undefined,
  },
});
