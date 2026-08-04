import { Image, StyleSheet, View } from 'react-native';
import { colors, radii } from '../../theme/tokens';

interface Props {
  /** Absent while the signature is still in flight. */
  url?: string;
  /** Position in its row or strip, which decides the placeholder fill. */
  index: number;
}

/**
 * One square of an album, in the strip on plan detail and in the grid on the
 * album screen.
 *
 * The two fills alternate so a row of tiles still waiting on their signatures
 * reads as a row rather than one flat block. That is the only non-obvious
 * idea in the album's visuals, which is why it lives here instead of being
 * re-derived by every surface that shows photos.
 */
export function PhotoTile({ url, index }: Props) {
  return (
    <View
      style={[
        styles.tile,
        { backgroundColor: index % 2 ? colors.photoPlaceholderAlt : colors.photoPlaceholder },
      ]}
    >
      {url ? <Image source={{ uri: url }} style={styles.fill} resizeMode="cover" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: radii.photoTile,
    overflow: 'hidden',
  },
  fill: {
    width: '100%',
    height: '100%',
  },
});
