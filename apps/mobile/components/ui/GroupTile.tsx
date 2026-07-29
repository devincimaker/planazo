import { View, StyleSheet } from 'react-native';
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
  size?: number;
  testID?: string;
}

/** Squarish colour tile that is the group's identity everywhere (6a–6e). */
export function GroupTile({ name, color, size = 46, testID }: GroupTileProps) {
  return (
    <View
      testID={testID}
      style={[
        styles.tile,
        {
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.32),
          backgroundColor: color ?? colorForName(name),
        },
      ]}
    >
      <ThemedText style={[styles.initial, { fontSize: Math.round(size * 0.44) }]}>
        {groupInitial(name)}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    fontFamily: fonts.displayHeavy,
    color: colors.ink,
    lineHeight: undefined,
  },
});
