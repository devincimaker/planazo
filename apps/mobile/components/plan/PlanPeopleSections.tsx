import { View, StyleSheet } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';
import type { PlanDerived } from '../../lib/planDerived';
import { ThemedText, Avatar } from '../ui';
import { colors, radii, spacing } from '../../theme/tokens';

/** The going chips, the ended plan's summary line, and the declined chips. */
export function PlanPeopleSections({ d }: { d: PlanDerived }) {
  return (
    <>
      <View style={styles.section}>
        <ThemedText variant="sectionLabel">
          {d.isCancelled ? 'Was going' : d.isExpired ? 'Were in' : d.isOpenFlexible ? 'In the mix' : 'Going'}
        </ThemedText>
        <View style={styles.people}>
          {d.youIn ? (
            <View style={[styles.person, d.isEnded ? styles.personEnded : styles.personYou]}>
              <Avatar name="You" dark size={26} />
              <ThemedText
                variant="bodyStrong"
                color={d.isEnded ? colors.textSecondary : colors.accentPressed}
              >
                You
              </ThemedText>
            </View>
          ) : null}
          {d.goingPeople.map((p) => (
            <View key={p.id} style={[styles.person, d.isEnded && styles.personEnded]}>
              <Avatar name={p.name} size={26} />
              <ThemedText
                variant="bodyStrong"
                color={d.isEnded ? colors.textSecondary : colors.textPrimary}
              >
                {p.name}
              </ThemedText>
            </View>
          ))}
        </View>
        {/* An ended plan keeps its one summary line. Naming the declines
            there would be a second sunken chip row under a sunken going
            row, which is two records competing where the screen only owes
            you a fact. A called-off plan stays silent about them entirely. */}
        {d.isExpired && (d.unanswered > 0 || d.outCount > 0) ? (
          <ThemedText variant="caption" color={colors.textMuted}>
            {[
              d.unanswered > 0 ? `${d.unanswered} never answered` : null,
              d.outCount > 0 ? `${d.outCount} couldn't make it` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </ThemedText>
        ) : null}
      </View>

      {/* PLA-29: who said no, named. Its own section so it never competes
          with the going list, and muted throughout so the weight matches
          what it means. Laid out live, so someone changing their mind while
          you are looking moves between the two lists. */}
      {!d.isEnded && (d.youOut || d.notGoingPeople.length > 0) ? (
        <Animated.View
          layout={LinearTransition}
          style={styles.section}
          testID="declined-section"
        >
          {/* Shares its wording with the footer's decline button, which is
              the point: the heading names the group that button puts you in. */}
          <ThemedText variant="sectionLabel">Can't make it</ThemedText>
          <View style={styles.people}>
            {d.youOut ? (
              <View style={[styles.person, styles.personOut]}>
                <View style={styles.avatarOut}>
                  <Avatar name="You" dark size={26} />
                </View>
                <ThemedText variant="bodyStrong" color={colors.textMuted}>
                  You
                </ThemedText>
              </View>
            ) : null}
            {d.notGoingPeople.map((p) => (
              <View key={p.id} style={[styles.person, styles.personOut]}>
                <View style={styles.avatarOut}>
                  <Avatar name={p.name} size={26} />
                </View>
                <ThemedText variant="bodyStrong" color={colors.textMuted}>
                  {p.name}
                </ThemedText>
              </View>
            ))}
          </View>
        </Animated.View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.sm,
  },
  people: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 7,
    paddingLeft: 7,
    paddingRight: 13,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
  },
  personYou: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  personEnded: {
    backgroundColor: colors.surfaceSunken,
    borderColor: colors.endedBorder,
  },
  // A no is the same pill with the air let out: sunken fill, the softer of the
  // two borders, and the name at muted rather than primary (PLA-29).
  personOut: {
    backgroundColor: colors.surfaceSunken,
    borderColor: colors.border,
  },
  // The face keeps its colour — it is how you recognise the person — but sits
  // back so the going list still wins the row.
  avatarOut: {
    opacity: 0.75,
  },
});
