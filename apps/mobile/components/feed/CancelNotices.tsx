import { View, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { fmtDay } from '../../lib/dates';
import { MIN_TOUCH_TARGET } from '../../lib/a11y';
import { type CancelNotice } from '../../lib/useCancelNotices';
import { ThemedText } from '../ui';
import { colors, spacing } from '../../theme/tokens';

/**
 * The 19e "Called off" notices above the feed. Presentational — the query and
 * the dismiss write live in useCancelNotices, which the screen calls so the
 * fetch runs alongside the plans query.
 */
export function CancelNotices({
  notices,
  onDismiss,
}: {
  notices: CancelNotice[];
  onDismiss: (noticeId: string) => void;
}) {
  const router = useRouter();

  if (notices.length === 0) return null;

  return (
    <View style={styles.notices}>
      {notices.map(({ noticeId, plan }) => {
        const name = plan.canceller?.display_name ?? 'The host';
        const date = plan.locked_date ?? plan.event_date;
        const line = plan.cancel_reason
          ? `${date ? `${fmtDay(date)} is off. ` : ''}${name} says “${plan.cancel_reason}”`
          : `${name} called this off.`;
        return (
          <View key={noticeId} style={styles.notice} testID={`cancel-notice-${plan.id}`}>
            <ThemedText variant="tag" color={colors.textMuted} style={styles.noticeLabel}>
              Called off
            </ThemedText>
            <ThemedText variant="cardTitle">{plan.title}</ThemedText>
            <ThemedText variant="sub" style={styles.noticeLine}>
              {line}
            </ThemedText>
            <View style={styles.noticeActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => onDismiss(noticeId)}
                style={styles.gotIt}
                testID={`got-it-${plan.id}`}
              >
                <ThemedText variant="bodyStrong">Got it</ThemedText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push(`/(app)/plan/${plan.id}`)}
                style={styles.seePlan}
                testID={`see-plan-${plan.id}`}
              >
                <ThemedText variant="bodyStrong" color={colors.textSecondary}>
                  See the plan
                </ThemedText>
              </Pressable>
            </View>
          </View>
        );
      })}
      <View style={styles.noticeDivider} />
    </View>
  );
}

const styles = StyleSheet.create({
  // 19e cancellation notice: stone, not red — it's news, not an alarm
  notices: {
    gap: spacing.md,
  },
  notice: {
    backgroundColor: colors.endedCard,
    borderWidth: 1,
    borderColor: colors.endedBorder,
    borderRadius: 22,
    paddingHorizontal: spacing.lg,
    paddingVertical: 15,
    gap: 3,
  },
  noticeLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.48,
  },
  noticeLine: {
    marginTop: spacing.xxs,
  },
  noticeActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginTop: spacing.sm + 1,
  },
  // 43 and 40 respectively — the two ways to answer a "this plan was called
  // off" notice. The row they sit in grows by 1pt (PLA-40).
  gotIt: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.endedBorder,
  },
  seePlan: {
    flex: 1,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET,
  },
  noticeDivider: {
    height: 1,
    backgroundColor: colors.tabBarBorder,
    marginVertical: 6,
  },
});
