import { View, StyleSheet } from 'react-native';
import { fmtDay, fmtTime } from '../../lib/dates';
import type { PlanDerived } from '../../lib/planDerived';
import { ThemedText, Card, SlotBar } from '../ui';
import { colors, spacing } from '../../theme/tokens';

// "Cancelled Thursday, 18:20" — weekday while it's fresh, full date after a week
const fmtStamp = (iso: string) => {
  const d = new Date(iso);
  const days = (Date.now() - d.getTime()) / 86400000;
  const day = days < 6.5 ? d.toLocaleDateString('en-GB', { weekday: 'long' }) : fmtDay(iso);
  return `${day}, ${fmtTime(iso)}`;
};

type Props = {
  plan: any;
  d: PlanDerived;
};

/** The status card: called off, didn't happen, or the live count. */
export function PlanStatusCard({ plan, d }: Props) {
  if (d.isCancelled) {
    // 19a/19b: the count is gone — a flat stone card carries the two
    // facts that matter: it's off, and why.
    return (
      <Card style={styles.endedCard}>
        <View style={styles.endedCardInner}>
          <ThemedText variant="statusHeadline" color={colors.textPrimary}>
            {d.youCancelled
              ? 'You called this off'
              : `${plan.canceller?.display_name ?? plan.creator?.display_name ?? 'The host'} called this off`}
          </ThemedText>
          {plan.cancel_reason ? (
            <ThemedText variant="body" color={colors.textSecondary}>
              “{plan.cancel_reason}”
            </ThemedText>
          ) : null}
          {plan.cancelled_at ? (
            <ThemedText variant="caption" color={colors.textMuted} style={styles.stamp}>
              {d.youCancelled
                ? fmtStamp(plan.cancelled_at)
                : `Cancelled ${fmtStamp(plan.cancelled_at)}`}
            </ThemedText>
          ) : null}
        </View>
      </Card>
    );
  }

  if (d.isExpired) {
    // 19c: the slot bar stays, frozen — here the count is the explanation.
    return (
      <Card style={styles.endedCard}>
        <View style={styles.statusTop}>
          <ThemedText variant="statusHeadline" color={colors.textPrimary} style={styles.headline}>
            {d.headline}
          </ThemedText>
          <ThemedText variant="caption" color={colors.textMuted}>
            {d.going} of {plan.min_people}
          </ThemedText>
        </View>
        <View style={styles.slotWrap}>
          <SlotBar going={d.going} min={plan.min_people} cap={plan.max_people} frozen />
        </View>
        <ThemedText variant="caption" color={colors.textMuted}>
          {d.capLine}
        </ThemedText>
      </Card>
    );
  }

  return (
    <Card>
      <View style={styles.statusTop}>
        <ThemedText
          variant="statusHeadline"
          color={d.confirmed ? colors.confirmed : colors.accent}
          style={styles.headline}
        >
          {d.headline}
        </ThemedText>
        <ThemedText variant="caption" color={colors.textFaint}>
          {d.going} in
        </ThemedText>
      </View>
      <View style={styles.slotWrap}>
        <SlotBar going={d.going} min={plan.min_people} cap={plan.max_people} />
      </View>
      <ThemedText variant="caption" color={d.confirmed ? colors.confirmed : colors.textMuted}>
        {d.capLine}
      </ThemedText>
    </Card>
  );
}

const styles = StyleSheet.create({
  statusTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: spacing.md,
  },
  headline: {
    flexShrink: 1,
  },
  slotWrap: {
    marginVertical: spacing.md,
  },
  endedCard: {
    backgroundColor: colors.endedCard,
    borderColor: colors.endedBorder,
  },
  endedCardInner: {
    gap: spacing.sm,
  },
  stamp: {
    paddingTop: spacing.xxs,
  },
});
