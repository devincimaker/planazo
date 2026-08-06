import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { NEEDS_GROUP_COPY, useGoToGroups } from '../../../components/group/NeedsGroupState';
import { ThemedText, Button } from '../../../components/ui';
import { colors, groupColors, spacing } from '../../../theme/tokens';

/**
 * What the "+" opens for someone in no groups (PLA-68).
 *
 * A sheet rather than the full create modal, because this is an interruption
 * and not a destination: the feed stays visible behind it, and "Not now" puts
 * you straight back. The create screen keeps its own copy of this message for
 * the deep-link path, which no button guards.
 *
 * The tiles are the ones the Groups tab already uses, so the two screens are
 * recognisably about the same thing.
 */
export default function NeedsGroupSheet() {
  const router = useRouter();
  const goToGroups = useGoToGroups(true);

  return (
    <View style={styles.sheet}>
      <View style={styles.art}>
        <View style={[styles.tile, { backgroundColor: groupColors[0] }]} />
        <View style={[styles.tile, { backgroundColor: groupColors[3] }]} />
        <View style={[styles.tile, styles.tileDashed]} />
      </View>

      <ThemedText variant="cardTitle" style={styles.centred}>
        {NEEDS_GROUP_COPY.title}
      </ThemedText>
      <ThemedText variant="sub" style={styles.body}>
        {NEEDS_GROUP_COPY.planBody}
      </ThemedText>

      <View style={styles.actions}>
        <Button label={NEEDS_GROUP_COPY.cta} onPress={goToGroups} testID="sort-out-group" />
        <Button
          label="Not now"
          variant="outline"
          // Nothing has been typed, so there is nothing to lose by leaving:
          // this sheet opens before the form, not over a half-written plan.
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(app)/(tabs)'))}
          testID="not-now"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // No flex: 1 anywhere in here. Inside a formSheet it resolves against the
  // content's natural height rather than the detent, which silently clips
  // whatever does not fit (see sheetDetents in theme/tokens).
  sheet: {
    backgroundColor: colors.background,
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    // The sheet stops above the home indicator but not far above it, and a
    // button flush with that edge is one the thumb fights for.
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
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
  centred: {
    textAlign: 'center',
  },
  body: {
    textAlign: 'center',
    maxWidth: 300,
  },
  actions: {
    alignSelf: 'stretch',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
});
