import { View, StyleSheet } from 'react-native';
import { OnboardingCard, CardArt } from './OnboardingCard';
import { ThemedText } from '../ui';
import { colors, fonts, radii, spacing } from '../../theme/tokens';

/** The design draws poll options at 20, between `radii.footerButton` and `radii.card`. */
const OPTION_RADIUS = 20;

interface OptionProps {
  label: string;
  votes: string;
  /** How much of the bar this option has won, 0 to 1. */
  share: number;
  picked?: boolean;
}

function Option({ label, votes, share, picked = false }: OptionProps) {
  const ink = picked ? colors.accentText : colors.textPrimary;

  return (
    <View style={[styles.option, picked ? styles.optionPicked : styles.optionPlain]}>
      <View style={styles.optionTop}>
        <ThemedText color={ink} style={styles.optionLabel}>
          {label}
        </ThemedText>
        <View style={styles.tally}>
          <ThemedText variant="caption" color={picked ? colors.accentText : colors.textMuted}>
            {votes}
          </ThemedText>
          {picked ? (
            <ThemedText color={colors.accent} style={styles.tick}>
              ✓
            </ThemedText>
          ) : null}
        </View>
      </View>
      <View style={styles.bar}>
        <View style={[styles.barFill, { width: `${share * 100}%` }]} />
      </View>
    </View>
  );
}

/**
 * Page 3: the one open question on a plan, and how it gets answered.
 *
 * "Which bar, which film" is the poll composer's own placeholder, so the
 * carousel teaches the example the user meets again the first time they open
 * it.
 */
export function PollCard({ width }: { width: number }) {
  return (
    <OnboardingCard
      width={width}
      title="Ask the group"
      body="Which bar, which film. Add a question to any plan, one pick each, and it's answered before you're out the door."
      testID="onboarding-poll"
    >
      <CardArt>
        <View style={styles.questionRow}>
          <ThemedText variant="sectionLabel">Which bar</ThemedText>
          <ThemedText variant="caption">3 of 5 voted</ThemedText>
        </View>

        <View style={styles.options}>
          <Option label="Bar Pepito" votes="2 votes" share={0.4} picked />
          <Option label="La Fuerza" votes="1 vote" share={0.2} />
        </View>

        <ThemedText variant="caption" style={styles.footnote}>
          One pick each. Tap another to change it.
        </ThemedText>
      </CardArt>
    </OnboardingCard>
  );
}

const styles = StyleSheet.create({
  questionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  options: {
    gap: spacing.sm,
  },
  option: {
    borderWidth: 1.5,
    borderRadius: OPTION_RADIUS,
    padding: spacing.lg,
    gap: 9,
  },
  optionPicked: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  optionPlain: {
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  optionTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  optionLabel: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 16,
    lineHeight: 20,
  },
  tally: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  tick: {
    fontFamily: fonts.bodySemiBold,
    lineHeight: 20,
  },
  bar: {
    height: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.divider,
    overflow: 'hidden',
  },
  barFill: {
    height: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
  footnote: {
    marginTop: 'auto',
    lineHeight: 19,
  },
});
