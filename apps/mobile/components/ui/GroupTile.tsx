import { useState } from 'react';
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

/** The squircle's corner at a given size. Exported so previews of the tile agree with it. */
export function tileRadius(size: number): number {
  return Math.round(size * 0.32);
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
  // A deleted object, a dead URL or a flaky network would otherwise leave a
  // tile with nothing in it at all. The letter on the colour is the fallback
  // everywhere else, so it is the fallback here too. Remembering *which* URL
  // failed rather than a bare flag means a replacement photo renders on the
  // first frame instead of showing the letter until an effect resets it.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  const showImage = !!imageUrl && imageUrl !== failedUrl;
  const radius = tileRadius(size);
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
          backgroundColor: showImage ? 'transparent' : color ?? colorForName(name),
        },
      ]}
    >
      {showImage ? (
        // The tile already clips to the squircle, so the image just fills it.
        <Image
          testID={testID ? `${testID}-image` : undefined}
          source={{ uri: imageUrl }}
          onError={() => setFailedUrl(imageUrl)}
          style={styles.fill}
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
  fill: {
    width: '100%',
    height: '100%',
  },
  initial: {
    fontFamily: fonts.displayHeavy,
    color: colors.ink,
    lineHeight: undefined,
  },
});
