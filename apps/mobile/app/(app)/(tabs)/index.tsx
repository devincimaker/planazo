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
  canVoteOnPolls,
  countAvailabilityByDate,
  countPollVotes,
  earliestViableDate,
  flattenNestedOptions,
  isPlanConfirmed,
  isPlanFull,
  isPlanPast,
  needsUserResponse,
  pollPeopleIn,
  pollVotedPhrase,
  waitlistPosition,
} from '@planazo/shared';
import { supabase } from '../../../lib/supabase';
import { deleteOwnRsvp, offerWaitingList } from '../../../lib/rsvp';
import { useVotePlanPoll } from '../../../lib/usePlanPoll';
import { actionErrorCopy, errorCopy } from '../../../lib/queryErrors';
import { usePullToRefresh } from '../../../lib/usePullToRefresh';
import { MIN_TOUCH_TARGET } from '../../../lib/a11y';
import { useAuthStore } from '../../../stores/authStore';
import { ThemedText, Chip, Avatar, EmptyState, ErrorState } from '../../../components/ui';
import { FeedPlanCard } from '../../../components/feed/FeedPlanCard';
import { CancelNotices } from '../../../components/feed/CancelNotices';
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

  const { data: plans, isLoading, isError, error, refetch } = useQuery({
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
          rsvps(user_id, response, waitlist_seq, profile:profiles(display_name)),
          plan_date_options(id, date, date_availability(user_id, profile:profiles(display_name))),
          plan_polls(id, question, created_at, plan_poll_options!plan_poll_options_poll_id_plan_id_fkey(id, label, position), plan_poll_votes(option_id, user_id))`
        )
        .in('group_id', groupIds)
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false })
        // A feed card is a summary: it carries the plan's first poll only,
        // and whoever wants the second is one tap from the plan. Selecting
        // it here keeps the embed small and deletes the client-side sort.
        .order('created_at', { referencedTable: 'plan_polls', ascending: true })
        .limit(1, { referencedTable: 'plan_polls' });

      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });
  const { refreshing, onRefresh } = usePullToRefresh(refetch);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['home-plans'] });

  const answerFixed = useMutation({
    mutationFn: async ({
      planId,
      response,
    }: {
      planId: string;
      response: 'yes' | 'no' | 'pending';
    }) => {
      const { error } = await supabase.from('rsvps').upsert(
        { plan_id: planId, user_id: user?.id, response },
        { onConflict: 'plan_id,user_id' }
      );
      if (error) throw error;
    },
    onSuccess: invalidate,
    // The plan can fill between the render and the tap. Rather than a dead end,
    // offer the thing that now exists (PLA-37).
    onError: (error, variables) =>
      offerWaitingList(error, () =>
        answerFixed.mutate({ planId: variables.planId, response: 'pending' })
      ),
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

  // One pick each, straight from the card: another option moves the vote,
  // your own withdraws it (PLA-47). The write, its invalidations and its
  // refusal copy all live in the shared hook.
  const voteOnPoll = useVotePlanPoll();

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

      // Only you see your own place in the queue (PLA-37).
      const waitPosition = waitlistPosition(plan.rsvps, user?.id);

      // The plan's first poll (PLA-47), votable right on the card — the
      // query keeps only the oldest one. The pick gate and the turnout
      // phrase are the shared derivations the plan screen also uses, so the
      // two surfaces cannot disagree about either.
      const pollRow = (plan.plan_polls ?? [])[0] ?? null;
      let poll: {
        id: string;
        question: string;
        options: { id: string; label: string; votes: number; mine: boolean }[];
        caption: string;
        canVote: boolean;
      } | null = null;
      if (pollRow) {
        const canVote = canVoteOnPolls(
          { created_by: plan.created_by, rsvps: plan.rsvps, availabilities },
          user?.id
        );
        const votes: { option_id: string; user_id: string }[] = pollRow.plan_poll_votes ?? [];
        const sortedOptions = [...(pollRow.plan_poll_options ?? [])].sort(
          (a: any, b: any) => a.position - b.position
        );
        const counts = countPollVotes(sortedOptions, votes);
        const myVote = votes.find((v) => v.user_id === user?.id);
        const options = sortedOptions.map((o: any) => ({
          id: o.id as string,
          label: o.label as string,
          votes: counts[o.id],
          mine: myVote?.option_id === o.id,
        }));
        const myPick = options.find((o) => o.mine);
        const base = pollVotedPhrase(votes.length, pollPeopleIn(plan.rsvps, availabilities));
        const caption = myPick
          ? `You picked ${myPick.label} · tap to change`
          : canVote
            ? `${base} · tap to vote`
            : base;
        poll = { id: pollRow.id, question: pollRow.question, options, caption, canVote };
      }

      return {
        poll,
        plan,
        isPast,
        confirmed,
        needs,
        userRsvp,
        rsvpDriven,
        isFull,
        waitPosition,
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

  const togglePicked = (planId: string, optionId: string) =>
    setPickedDates((prev) => {
      const picked = prev[planId] ?? [];
      return {
        ...prev,
        [planId]: picked.includes(optionId)
          ? picked.filter((id) => id !== optionId)
          : [...picked, optionId],
      };
    });

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
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <ErrorState {...errorCopy(error)} onRetry={() => refetch()} testID="feed-error" />
        </ScrollView>
      ) : (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <CancelNotices onOpenPlan={openPlan} />

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
            visible.map((d) => (
              <FeedPlanCard
                key={d.plan.id}
                d={d}
                picked={pickedDates[d.plan.id] ?? []}
                onTogglePicked={(optionId) => togglePicked(d.plan.id, optionId)}
                onOpen={() => openPlan(d.plan.id)}
                onAnswer={(response) => answerFixed.mutate({ planId: d.plan.id, response })}
                onClearAnswer={() => clearAnswer.mutate(d.plan.id)}
                onSendDates={(optionIds) => sendDates.mutate({ planId: d.plan.id, optionIds })}
                onDecline={() =>
                  declineFlexible.mutate({ planId: d.plan.id, optionIds: d.optionIds })
                }
                onVote={(pollId, optionId) =>
                  voteOnPoll.mutate({ planId: d.plan.id, pollId, userId: user!.id, optionId })
                }
              />
            ))
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
});
