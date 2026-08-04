import { View, StyleSheet, Pressable, Alert } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { actionErrorCopy } from '../../lib/queryErrors';
import { MIN_TOUCH_TARGET } from '../../lib/a11y';
import { useAuthStore } from '../../stores/authStore';
import { ThemedText } from '../ui';
import { colors, spacing } from '../../theme/tokens';

const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

// A failed write is never "Error: <raw postgres message>". actionErrorCopy
// names the cases worth naming — a full plan above all (PLA-20).
const alertActionError = (error: unknown) => {
  const { title, body } = actionErrorCopy(error);
  Alert.alert(title, body);
};

/**
 * 19e: a cancellation of a plan you'd said yes to earns one dismissable
 * notice above the feed. The unread plan_cancelled row *is* the pin — the
 * RPC only writes them for people who were in, and 24h clears it either way.
 */
export function CancelNotices({ onOpenPlan }: { onOpenPlan: (planId: string) => void }) {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();

  const { data: cancelNotices } = useQuery({
    queryKey: ['cancel-notices', user?.id],
    queryFn: async () => {
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { data: notes, error } = await supabase
        .from('notifications')
        .select('id, data, created_at')
        .eq('user_id', user!.id)
        .eq('type', 'plan_cancelled')
        .eq('read', false)
        .gte('created_at', since)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const planIds = [
        ...new Set((notes ?? []).map((n: any) => n.data?.plan_id).filter(Boolean)),
      ];
      if (planIds.length === 0) return [];
      const { data: cancelledPlans, error: planError } = await supabase
        .from('plans')
        .select(
          'id, title, status, event_date, locked_date, cancel_reason, canceller:profiles!plans_cancelled_by_fkey(display_name)'
        )
        .in('id', planIds);
      if (planError) throw planError;
      const byId = new Map((cancelledPlans ?? []).map((p: any) => [p.id, p]));
      return (notes ?? [])
        .map((n: any) => ({ noticeId: n.id as string, plan: byId.get(n.data?.plan_id) }))
        // A restored plan takes its notice with it
        .filter((n: any) => n.plan && n.plan.status === 'cancelled');
    },
    enabled: !!user,
  });

  const dismissNotice = useMutation({
    mutationFn: async (noticeId: string) => {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('id', noticeId);
      if (error) throw error;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['cancel-notices'] }),
    onError: alertActionError,
  });

  if ((cancelNotices ?? []).length === 0) return null;

  return (
    <View style={styles.notices}>
      {(cancelNotices ?? []).map(({ noticeId, plan }: any) => {
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
                onPress={() => dismissNotice.mutate(noticeId)}
                style={styles.gotIt}
                testID={`got-it-${plan.id}`}
              >
                <ThemedText variant="bodyStrong">Got it</ThemedText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => onOpenPlan(plan.id)}
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
