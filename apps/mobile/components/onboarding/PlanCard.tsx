import { View, StyleSheet } from 'react-native';
import { OnboardingCard, CardArt } from './OnboardingCard';
import { ThemedText, DateOptionRow, SlotBar, Badge } from '../ui';
import { colors, groupColors, spacing } from '../../theme/tokens';

/**
 * Page 2: a plan doesn't need the day settled to exist. Put up the dates that
 * could work and the group's ticks decide it.
 *
 * `DateOptionRow`, `SlotBar` and `Badge` are the real components, not
 * lookalikes, so this page keeps telling the truth as they change.
 */
export function PlanCard({ width }: { width: number }) {
  return (
    <OnboardingCard
      width={width}
      stripe={groupColors[0]}
      title="Throw out a plan"
      body="One date, or a few. Put up a few and everyone ticks what they can do, so the day settles itself."
      testID="onboarding-plan"
    >
      <CardArt>
        <View style={styles.groupRow}>
          <View style={styles.swatch} />
          <ThemedText variant="caption" color={colors.textSecondary}>
            Los de Siempre
          </ThemedText>
          <View style={styles.badgeSlot}>
            <Badge label="Open" tone="open" />
          </View>
        </View>

        <View style={styles.dates}>
          <DateOptionRow label="Thu 21 Aug" meta="4 free" selected />
          <DateOptionRow label="Sat 23 Aug" meta="5 free" />
          <DateOptionRow label="Sun 24 Aug" meta="2 free" />
        </View>

        <View style={styles.slots}>
          <ThemedText variant="caption">Two more to make the plan happen</ThemedText>
          <SlotBar going={3} min={5} cap={6} />
        </View>
      </CardArt>
    </OnboardingCard>
  );
}

const styles = StyleSheet.create({
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  swatch: {
    width: 20,
    height: 20,
    borderRadius: 6,
    backgroundColor: groupColors[0],
  },
  badgeSlot: {
    marginLeft: 'auto',
  },
  dates: {
    gap: spacing.sm,
  },
  slots: {
    marginTop: 'auto',
    gap: 10,
  },
});
