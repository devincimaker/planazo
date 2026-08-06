import { View, StyleSheet } from 'react-native';
import { colors, groupColors, spacing } from '../../theme/tokens';

/**
 * Two groups and an empty slot: the mark that means "a group" wherever the app
 * has to explain what one is. The Groups tab's empty state and the
 * needs-a-group sheet both wear it, which is what makes them read as the same
 * conversation rather than two unrelated screens (PLA-68).
 *
 * `middle` exists because the two surfaces sit on different backgrounds and
 * were tuned separately; keeping the sizes here is the point, since those are
 * what would otherwise drift.
 */
export function GroupTiles({ middle = colors.border }: { middle?: string }) {
  return (
    <View style={styles.art}>
      <View style={[styles.tile, { backgroundColor: groupColors[0] }]} />
      <View style={[styles.tile, { backgroundColor: middle }]} />
      <View style={[styles.tile, styles.tileDashed]} />
    </View>
  );
}

const styles = StyleSheet.create({
  art: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  tile: {
    width: 52,
    height: 52,
    borderRadius: 17,
  },
  tileDashed: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
  },
});
