import { useMemo, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  RefreshControl,
  Pressable,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  countAvailabilityByDate,
  earliestViableDate,
  flattenNestedOptions,
  isPlanConfirmed,
  isPlanFull,
  isPlanPast,
  needsUserResponse,
} from '@planazo/shared';
import { supabase } from '../../../lib/supabase';
import { deleteOwnRsvp } from '../../../lib/rsvp';
import { actionErrorCopy, errorCopy } from '../../../lib/queryErrors';
import { MIN_TOUCH_TARGET } from '../../../lib/a11y';
import { useAuthStore } from '../../../stores/authStore';
import {
  ThemedText,
  Card,
  Chip,
  Badge,
  Avatar,
  AvatarStack,
  AnswerFooter,
  ButtonRow,
  DateOptionRow,
  EmptyState,
  ErrorState,
  colorForName,
} from '../../../components/ui';
import { colors, spacing } from '../../../theme/tokens';

type Filter = 'all' | 'needs' | 'happening';

const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

// A failed write is never "Error: <raw postgres message>". actionErrorCopy
// names the cases worth naming — a full plan above all (PLA-20).
const alertActionError = (error: unknown) => {
  const { title, body } = actionErrorCopy(error);
  Alert.alert(title, body);
};

export default function FeedScreen() {
  const { profile, user } = useAuthStore();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');
  // Local date selections per flexible plan, committed on "Send N dates"
  const [pickedDates, setPickedDates] = useState<Record<string, string[]>>({});

  const { data: plans, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ['home-plans', user?.id],
    queryFn: async () => {
      const { data: memberships, error: memberError } = await supabase
        .from('group_members')
        .select('group_id')
        .eq('user_id', user?.id);

      if (memberError) throw memberError;
      const groupIds = (memberships ?? []).map((m) => m.group_id);
      if (groupIds.length === 0) return [];

      const { data, error } = await supabase
        .from('plans')
        .select(
          `*,
          groups(id, name, color),
          rsvps(user_id, response, profile:profiles(display_name)),
          plan_date_options(id, date, date_availability(user_id, profile:profiles(display_name)))`
        )
        .in('group_id', groupIds)
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['home-plans'] });

  // 19e: a cancellation of a plan you'd said yes to earns one dismissable
  // notice above the feed. The unread plan_cancelled row *is* the pin — the
  // RPC only writes them for people who were in, and 24h clears it either way.
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

  const answerFixed = useMutation({
    mutationFn: async ({ planId, response }: { planId: string; response: 'yes' | 'no' }) => {
      const { error } = await supabase.from('rsvps').upsert(
        { plan_id: planId, user_id: user?.id, response },
        { onConflict: 'plan_id,user_id' }
      );
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: alertActionError,
  });

  const clearAnswer = useMutation({
    mutationFn: (planId: string) => deleteOwnRsvp(planId, user!.id),
    onSuccess: invalidate,
    onError: alertActionError,
  });

  const sendDates = useMutation({
    mutationFn: async ({ planId, optionIds }: { planId: string; optionIds: string[] }) => {
      const rows = optionIds.map((optionId) => ({
        plan_id: planId,
        user_id: user?.id,
        date_option_id: optionId,
        available: true,
      }));
      const { error } = await supabase
        .from('date_availability')
        .upsert(rows, { onConflict: 'plan_id,user_id,date_option_id' });
      if (error) throw error;
    },
    onSuccess: (_data, { planId }) => {
      setPickedDates((prev) => ({ ...prev, [planId]: [] }));
      invalidate();
    },
    onError: alertActionError,
  });

  const declineFlexible = useMutation({
    mutationFn: async ({ planId, optionIds }: { planId: string; optionIds: string[] }) => {
      const { error } = await supabase.from('rsvps').upsert(
        { plan_id: planId, user_id: user?.id, response: 'no' },
        { onConflict: 'plan_id,user_id' }
      );
      if (error) throw error;
      if (optionIds.length > 0) {
        const { error: availError } = await supabase
          .from('date_availability')
          .delete()
          .eq('user_id', user!.id)
          .in('date_option_id', optionIds);
        if (availError) throw availError;
      }
    },
    onSuccess: invalidate,
    onError: alertActionError,
  });

  const decorated = useMemo(() => {
    return (plans ?? []).map((plan: any) => {
      const { dateOptions, availabilities } = flattenNestedOptions(plan.plan_date_options);
      const planData = {
        plan_type: plan.plan_type,
        status: plan.status,
        min_people: plan.min_people,
        rsvps: plan.rsvps,
        dateOptions,
        availabilities,
      };
      const confirmed = isPlanConfirmed(planData);
      const needs = needsUserResponse(planData, user?.id);
      const userRsvp = (plan.rsvps ?? []).find((r: any) => r.user_id === user?.id);
      const myDates = availabilities.filter((a) => a.user_id === user?.id).length;
      const countByDate = countAvailabilityByDate(dateOptions, availabilities);
      // No live vote — either there never was one, or locking ended it. Both
      // who's in and what you can answer then read the RSVP rows, so the two
      // must be decided together or they drift apart.
      const rsvpDriven = plan.plan_type === 'fixed' || plan.status === 'locked';

      let when: string;
      if (plan.locked_date) {
        when = `${fmtDay(plan.locked_date)} · ${fmtTime(plan.locked_date)}`;
      } else if (plan.event_date) {
        when = `${fmtDay(plan.event_date)} · ${fmtTime(plan.event_date)}`;
      } else {
        when = `${dateOptions.length} date${dateOptions.length === 1 ? '' : 's'} on the table`;
      }

      // Who's in comes from the vote only while the vote is running. Once
      // locked, the RSVP rows are the attendance — same rule as plan detail —
      // so someone who withdraws actually leaves the stack.
      let goingNames: string[];
      if (rsvpDriven) {
        goingNames = (plan.rsvps ?? [])
          .filter((r: any) => r.response === 'yes')
          .map((r: any) => r.profile?.display_name ?? '?');
      } else {
        const seen = new Map<string, string>();
        (plan.plan_date_options ?? []).forEach((opt: any) =>
          (opt.date_availability ?? []).forEach((a: any) => {
            seen.set(a.user_id, a.profile?.display_name ?? '?');
          })
        );
        goingNames = [...seen.values()];
      }

      const sortDate =
        plan.locked_date ?? plan.event_date ?? earliestViableDate(countByDate, plan.min_people);

      // 19e: Plans only ever holds things that still need you — expired and
      // past-confirmed plans leave silently at the end of their day.
      const isPast = isPlanPast(plan, dateOptions.map((o) => o.date));

      // Every place taken (PLA-20). Only asked while a yes is what the plan
      // wants — a running vote hands out no seats until it locks.
      const isFull = rsvpDriven && isPlanFull({ max_people: plan.max_people, rsvps: plan.rsvps });

      return {
        plan,
        isPast,
        confirmed,
        needs,
        userRsvp,
        rsvpDriven,
        isFull,
        myDates,
        when,
        goingNames,
        dateOptions,
        countByDate,
        optionIds: dateOptions.map((o) => o.id),
        sortKey: sortDate ? new Date(sortDate).getTime() : Number.MAX_SAFE_INTEGER,
      };
    });
  }, [plans, user?.id]);

  const visible = useMemo(() => {
    const filtered = decorated.filter(
      (d) =>
        !d.isPast && (filter === 'needs' ? d.needs : filter === 'happening' ? d.confirmed : true)
    );
    return filtered.sort((a, b) =>
      a.needs !== b.needs ? (a.needs ? -1 : 1) : a.sortKey - b.sortKey
    );
  }, [decorated, filter]);

  const openPlan = (planId: string) => router.push(`/(app)/plan/${planId}`);

  const renderAnswer = (d: (typeof decorated)[number]) => {
    const { plan } = d;
    // A called-off plan is a record — the notice above the feed carries it.
    if (plan.status === 'cancelled') return null;

    // Once a plan locks, the date is real and the vote is over, so a locked
    // flexible plan answers like a fixed one: a plain yes/no on your own row.
    // It has to stay reachable — locking seeds every available member into a
    // 'yes' they never tapped, and that's exactly when a clash shows up.
    if (d.rsvpDriven) {
      if (d.userRsvp?.response === 'yes' || d.userRsvp?.response === 'no') {
        return (
          <AnswerFooter
            size="md"
            answered={d.userRsvp.response}
            onChange={() => clearAnswer.mutate(plan.id)}
          />
        );
      }
      return (
        <AnswerFooter
          size="md"
          full={d.isFull}
          onYes={() => answerFixed.mutate({ planId: plan.id, response: 'yes' })}
          onNo={() => answerFixed.mutate({ planId: plan.id, response: 'no' })}
        />
      );
    }

    // Flexible: answer inline — tap the dates that work, send them (2a)
    if (d.userRsvp?.response === 'no') {
      return (
        <AnswerFooter size="md" answered="no" onChange={() => clearAnswer.mutate(plan.id)} />
      );
    }
    if (d.myDates > 0) {
      return (
        <AnswerFooter
          size="md"
          answered="yes"
          answerLabel={`You sent ${d.myDates} date${d.myDates === 1 ? '' : 's'}`}
          onChange={() => openPlan(plan.id)}
        />
      );
    }

    const picked = pickedDates[plan.id] ?? [];
    const togglePicked = (optionId: string) =>
      setPickedDates((prev) => ({
        ...prev,
        [plan.id]: picked.includes(optionId)
          ? picked.filter((id) => id !== optionId)
          : [...picked, optionId],
      }));

    return (
      <View style={styles.chips}>
        {d.dateOptions.map((opt) => (
          <DateOptionRow
            key={opt.id}
            label={fmtDay(opt.date)}
            meta={`${d.countByDate[opt.id]?.count ?? 0} free`}
            selected={picked.includes(opt.id)}
            onPress={() => togglePicked(opt.id)}
            testID={`date-option-${opt.id}`}
          />
        ))}
        <ButtonRow
          size="md"
          style={styles.chipButtons}
          secondary={{
            label: "Can't make it",
            variant: 'secondary',
            onPress: () => declineFlexible.mutate({ planId: plan.id, optionIds: d.optionIds }),
          }}
          primary={
            picked.length === 0
              ? {
                  label: 'Tap the dates you can do',
                  variant: 'secondary',
                  disabled: true,
                  haptic: false,
                }
              : {
                  label: `Send ${picked.length} date${picked.length === 1 ? '' : 's'}`,
                  onPress: () => sendDates.mutate({ planId: plan.id, optionIds: picked }),
                }
          }
        />
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <ThemedText variant="headerTitle">Planazo</ThemedText>
        <Pressable
          onPress={() => router.push('/(app)/profile')}
          accessibilityRole="button"
          accessibilityLabel="Profile"
          testID="feed-avatar"
          style={styles.avatarAction}
        >
          <Avatar name={profile?.display_name ?? '?'} dark size={36} imageUrl={profile?.avatar_url} />
        </Pressable>
      </View>

      <View style={styles.filters}>
        <Chip label="All" active={filter === 'all'} onPress={() => setFilter('all')} />
        <Chip label="Unanswered" active={filter === 'needs'} onPress={() => setFilter('needs')} />
        <Chip
          label="Happening"
          active={filter === 'happening'}
          onPress={() => setFilter('happening')}
        />
      </View>

      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : isError ? (
        // Still a ScrollView so pull-to-refresh survives: the old spinner replaced
        // the whole list, leaving a stuck feed no way out but a relaunch (PLA-15).
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.errorContent}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />}
        >
          <ErrorState {...errorCopy(error)} onRetry={() => refetch()} testID="feed-error" />
        </ScrollView>
      ) : (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />}
        >
          {(cancelNotices ?? []).length > 0 ? (
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
                        onPress={() => openPlan(plan.id)}
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
          ) : null}

          {visible.length === 0 ? (
            <EmptyState
              title={filter === 'needs' ? 'Nothing to answer' : 'Nothing on the table'}
              body={
                filter === 'needs'
                  ? 'When someone in a group proposes a plan, it lands here.'
                  : 'Start something. Pick a group, throw out a date or a few, and see who bites.'
              }
              ctaLabel="Start a plan"
              onPress={() => router.push('/(app)/plan/create')}
            />
          ) : (
            visible.map((d) => {
              const groupName = d.plan.groups?.name ?? 'Group';
              const groupColor = d.plan.groups?.color ?? colorForName(groupName);
              return (
                <Card key={d.plan.id} stripeColor={groupColor} testID={`plan-card-${d.plan.id}`}>
                  <Pressable onPress={() => openPlan(d.plan.id)}>
                    <View style={styles.cardTop}>
                      <View style={styles.groupRow}>
                        <View style={[styles.swatch, { backgroundColor: groupColor }]} />
                        <ThemedText variant="caption" color={colors.textSecondary}>
                          {groupName}
                        </ThemedText>
                      </View>
                      {/*
                        Two independent facts share one slot, so the label has
                        to pick. "Unanswered" is the one that is always true
                        when it shows: a plan with its numbers can still be
                        waiting on your reply, and the old "Needs you" claimed
                        the plan was short of people when often it was not.
                      */}
                      <Badge
                        label={d.needs ? 'Unanswered' : d.confirmed ? 'Confirmed' : 'Open'}
                        tone={d.needs ? 'open' : d.confirmed ? 'confirmed' : 'muted'}
                      />
                    </View>

                    <ThemedText variant="cardTitle" style={styles.title}>
                      {d.plan.title}
                    </ThemedText>
                    <ThemedText variant="bodyStrong">{d.when}</ThemedText>
                    {d.plan.location || d.plan.description ? (
                      <ThemedText variant="sub" numberOfLines={1} style={styles.sub}>
                        {d.plan.location ?? d.plan.description}
                      </ThemedText>
                    ) : null}

                    {d.goingNames.length > 0 && !(d.plan.plan_type === 'flexible' && d.needs) ? (
                      <View style={styles.faces}>
                        <AvatarStack
                          names={d.goingNames}
                          label={
                            d.goingNames.length < d.plan.min_people
                              ? `${d.goingNames.length} of ${d.plan.min_people} needed`
                              : `${d.goingNames.length} going`
                          }
                        />
                      </View>
                    ) : null}
                  </Pressable>

                  <View style={styles.answer}>{renderAnswer(d)}</View>
                </Card>
              );
            })
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  // The avatar is drawn at 36; the box around it is 44 and the negative margin
  // hands those 8 points back, so the header keeps its height and the avatar
  // does not shift off the right edge (PLA-40).
  avatarAction: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    margin: -(MIN_TOUCH_TARGET - 36) / 2,
  },
  filters: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    // Chip went from 37 to 44 to be tappable; give 4 of those 7 points back
    // here so the feed below only moves by 3 (PLA-40).
    paddingBottom: spacing.sm,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: 120,
    gap: spacing.lg,
  },
  errorContent: {
    flexGrow: 1,
    paddingBottom: 120,
  },
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
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  swatch: {
    width: 20,
    height: 20,
    borderRadius: 6,
  },
  title: {
    marginBottom: spacing.xs,
  },
  sub: {
    marginTop: spacing.xxs,
  },
  faces: {
    marginTop: spacing.md,
  },
  answer: {
    marginTop: spacing.md,
  },
  chips: {
    gap: spacing.sm,
  },
  chipButtons: {
    marginTop: spacing.xxs,
  },
});
