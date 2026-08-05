import { View, StyleSheet, Image } from 'react-native';
import { ThemedText } from './ThemedText';
import { colors, fonts, groupColors } from '../../theme/tokens';

interface AvatarProps {
  name: string;
  /** Explicit background; otherwise derived stably from the name */
  bg?: string;
  /** Dark ink treatment (the current user in headers) */
  dark?: boolean;
  size?: number;
  imageUrl?: string | null;
  testID?: string;
}

/** Stable color pick so the same person is the same color everywhere. */
export function colorForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  // The modulo keeps the index in range; the compiler cannot see that.
  return groupColors[Math.abs(hash) % groupColors.length]!;
}

export function Avatar({ name, bg, dark = false, size = 26, imageUrl, testID }: AvatarProps) {
  const initial = (name.trim()[0] ?? '?').toUpperCase();
  const backgroundColor = dark ? colors.ink : bg ?? colorForName(name);

  return (
    <View
      testID={testID}
      accessibilityLabel={name}
      style={[
        styles.base,
        { width: size, height: size, borderRadius: size / 2, backgroundColor },
      ]}
    >
      {imageUrl ? (
        <Image
          source={{ uri: imageUrl }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
        />
      ) : (
        <ThemedText
          color={dark ? colors.background : colors.ink}
          style={[styles.initial, { fontSize: Math.round(size * 0.42) }]}
        >
          {initial}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  initial: {
    fontFamily: fonts.bodyBold,
    lineHeight: undefined,
  },
});
