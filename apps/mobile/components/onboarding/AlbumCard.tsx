import { View, StyleSheet } from 'react-native';
import { OnboardingCard, CardArt } from './OnboardingCard';
import { ThemedText, Button } from '../ui';
import { colors, radii, spacing } from '../../theme/tokens';

/** Two fills rather than one, so a waiting grid reads as tiles and not a block. */
const ROWS = [
  [colors.photoPlaceholder, colors.photoPlaceholderAlt, colors.photoPlaceholder],
  [colors.photoPlaceholderAlt, colors.photoPlaceholder, colors.photoPlaceholderAlt],
];

/**
 * Page 4: what you are left holding once the plan is over, and the only page
 * with a way out of the deck.
 *
 * The tiles are the album's own placeholder fills. The button is real, so it
 * stays outside the CardArt, and it is the last thing focus reaches here.
 */
export function AlbumCard({ width, onGetStarted }: { width: number; onGetStarted: () => void }) {
  return (
    <OnboardingCard
      width={width}
      title="Keep the night"
      body="Everyone's photos land in one album on the plan. Next week it's still there."
      testID="onboarding-album"
    >
      <CardArt>
        {ROWS.map((row, i) => (
          <View key={i} style={styles.row}>
            {row.map((fill, j) => (
              <View key={j} style={[styles.tile, { backgroundColor: fill }]} />
            ))}
          </View>
        ))}
        <ThemedText>18 photos from 5 people</ThemedText>
      </CardArt>

      <Button label="Get started" onPress={onGetStarted} testID="onboarding-get-started" />
    </OnboardingCard>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  tile: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: radii.photoTile,
  },
});
