import { useMemo, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Share,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { canVoteOnPolls, pollPeopleIn } from '@planazo/shared';
import { PhotoAlbumCard } from '../../../../components/PhotoAlbumCard';
import { PlanPolls } from '../../../../components/PlanPolls';
import { PlanTopBar } from '../../../../components/plan/PlanTopBar';
import { PlanStatusCard } from '../../../../components/plan/PlanStatusCard';
import { DateVoteList } from '../../../../components/plan/DateVoteList';
import { PlanPeopleSections } from '../../../../components/plan/PlanPeopleSections';
import { PlanDetailFooter } from '../../../../components/plan/PlanDetailFooter';
import { fmtDay, fmtTime } from '../../../../lib/dates';
import { errorCopy, isNotFoundError } from '../../../../lib/queryErrors';
import { usePullToRefresh } from '../../../../lib/usePullToRefresh';
import { usePlanDetail } from '../../../../lib/usePlanDetail';
import { derivePlanDetail } from '../../../../lib/planDerived';
import { useAuthStore } from '../../../../stores/authStore';
import {
  ThemedText,
  Card,
  Badge,
  Button,
  ListRow,
  ErrorState,
  colorForName,
} from '../../../../components/ui';
import { colors, spacing } from '../../../../theme/tokens';

export default function PlanDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  // null = not editing dates; array = local picks being edited.
  //
  // Stamped with the plan they were made on. A deep link — a push tap, a shared
  // planazo://plan/<id> — resolves to this same route, so expo-router swaps
  // `id` under the mounted screen instead of remounting it. Unstamped picks
  // survived that swap: plan B rendered with zero rows ticked and an enabled
  // "Update your dates", and sending would have upserted plan A's
  // date_option_ids against plan B's plan_id (PLA-18). Checked on read below,
  // not reset in an effect, so there is no frame where the wrong picks are live.
  const [editingPicks, setEditingPicks] = useState<{ planId: string; picks: string[] } | null>(
    null
  );
  const activePicks = editingPicks && editingPicks.planId === id ? editingPicks.picks : null;

  // The footer floats over the scroll, so the content has to end above it. Its
  // height was a hand-measured constant, which stopped clearing it the moment a
  // footer button wrapped to two lines at large text sizes — the last date row
  // ended up underneath the bar. Measured instead, it clears whatever the bar
  // actually is.
  const [footerHeight, setFooterHeight] = useState(0);

  const {
    plan,
    isLoading,
    isError,
    error,
    refetch,
    rsvps,
    dateOptions,
    availabilities,
    membership,
    memberIds,
    answerRsvp,
    clearRsvp,
    sendDates,
    declineAll,
    lockPlan,
    reopenPlan,
    restorePlan,
  } = usePlanDetail(id, { onDatesCommitted: () => setEditingPicks(null) });
  const { refreshing, onRefresh } = usePullToRefresh(refetch);

  const derived = useMemo(
    () =>
      derivePlanDetail({
        plan,
        rsvps,
        dateOptions,
        availabilities,
        membership,
        memberIds,
        userId: user?.id,
      }),
    [plan, rsvps, dateOptions, availabilities, membership, memberIds, user?.id]
  );

  const goBack = () =>
    router.canGoBack() ? router.back() : router.replace('/(app)/(tabs)');

  // A plan you can't see and a plan that doesn't exist look identical from here
  // — RLS filters it to zero rows either way, so `.single()` throws PGRST116.
  // Say so instead of spinning forever (PLA-19).
  if (!isLoading && (isError || !plan)) {
    const notFound = !id || isNotFoundError(error);
    const copy = notFound
      ? {
          title: "This plan isn't here",
          body: "It was called off and cleared, or it belongs to a group you're not in. Ask whoever shared it to add you.",
        }
      : errorCopy(error);

    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <ErrorState
          title={copy.title}
          body={copy.body}
          onRetry={notFound ? undefined : () => refetch()}
          onBack={goBack}
          testID="plan-error"
        />
      </SafeAreaView>
    );
  }

  if (isLoading || !plan || !derived) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  const d = derived;
  const groupName = plan.groups?.name ?? 'Group';
  const groupColor = plan.groups?.color ?? colorForName(groupName);
  // The date rows are always tappable, so the footer must follow them: you're
  // editing the moment you start picking, even over a standing "no". Gating
  // this on !userRsvp let a declined plan's rows toggle while the footer stayed
  // on "You can't make it" — picks that could never be sent (PLA-17). Send
  // commits the picks and clears the "no" (sendDates); leaving keeps it.
  const editing =
    d.isOpenFlexible && (activePicks !== null || (d.myPickIds.length === 0 && !d.userRsvp));
  const picked = activePicks ?? d.myPickIds;

  const togglePick = (optionId: string) => {
    const base = activePicks ?? d.myPickIds;
    setEditingPicks({
      planId: id,
      picks: base.includes(optionId) ? base.filter((x) => x !== optionId) : [...base, optionId],
    });
  };

  const nudge = () =>
    Share.share({ message: `"${plan.title}" needs answers on Planazo: planazo://plan/${plan.id}` });

  const tryAgain = () =>
    router.push({
      pathname: '/plan/create',
      params: {
        groupId: plan.group_id,
        title: plan.title,
        min: String(plan.min_people),
        ...(plan.max_people ? { cap: String(plan.max_people) } : {}),
        ...(plan.location ? { location: plan.location, details: '1' } : {}),
      },
    });

  const statusBadge = d.isCancelled
    ? { label: 'Called off', ended: true }
    : d.isExpired
      ? { label: "Didn't happen", ended: true }
      : d.confirmed
        ? { label: 'Confirmed', tone: 'confirmed' as const }
        : { label: 'Open', tone: 'open' as const };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <PlanTopBar planId={plan.id} groupId={plan.group_id} d={d} groupName={groupName} onNudge={nudge} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: footerHeight + spacing.xxl }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.titleBlock}>
          <View style={styles.chipRow}>
            {'ended' in statusBadge ? (
              <Badge
                label={statusBadge.label}
                tone="custom"
                bg={colors.endedBadge}
                fg={colors.textSecondary}
                uppercase
              />
            ) : (
              <Badge label={statusBadge.label} tone={statusBadge.tone} uppercase />
            )}
            <View style={[styles.swatch, { backgroundColor: groupColor }]} />
            <ThemedText variant="caption">{groupName}</ThemedText>
          </View>
          <ThemedText
            variant="screenTitle"
            color={d.isEnded ? colors.textSecondary : colors.textPrimary}
          >
            {plan.title}
          </ThemedText>
          {plan.description ? (
            <ThemedText variant="sub" color={d.isEnded ? colors.textMuted : colors.textSecondary}>
              {plan.description}
            </ThemedText>
          ) : null}
        </View>

        <PlanStatusCard plan={plan} d={d} />

        {d.isOpenFlexible && !d.isPast ? (
          <DateVoteList
            dateOptions={dateOptions}
            countByDate={d.countByDate}
            leadId={d.leadId}
            picked={picked}
            minPeople={plan.min_people}
            onToggle={togglePick}
          />
        ) : null}

        {/* The plan's polls (PLA-47). Below the date vote on purpose: when is
            still the primary decision, what is a detail of it. The pick gate
            and the denominator are the shared client mirrors of the SQL
            predicate — NOT d.isHost, which also covers group admins: an
            admin manages polls (isHost) but holds no pick until they
            answer. */}
        {user ? (
          <PlanPolls
            planId={String(id)}
            userId={user.id}
            isHost={d.isHost}
            peopleIn={pollPeopleIn(rsvps, availabilities)}
            canVote={canVoteOnPolls(
              { created_by: plan.created_by, rsvps, availabilities },
              user.id
            )}
            planEnded={d.isCancelled || d.isPast}
          />
        ) : null}

        <Animated.View layout={LinearTransition}>
          <Card padded={false} style={d.isEnded ? styles.endedDetails : null}>
            {d.isLocked && plan.locked_date ? (
              <Animated.View entering={FadeInDown}>
                <ListRow
                  title={fmtDay(plan.locked_date)}
                  value={fmtTime(plan.locked_date)}
                  struck={d.isCancelled}
                />
              </Animated.View>
            ) : null}
            {plan.event_date ? (
              <ListRow
                title={fmtDay(plan.event_date)}
                value={fmtTime(plan.event_date)}
                struck={d.isCancelled}
              />
            ) : null}
            {plan.location ? (
              <ListRow
                title={plan.location}
                divider={!!plan.event_date || (d.isLocked && !!plan.locked_date)}
                right={
                  d.isEnded ? undefined : (
                    <ThemedText variant="bodyStrong" color={colors.accent}>
                      Map
                    </ThemedText>
                  )
                }
              />
            ) : null}
            <ListRow
              title={
                // created_by goes null when the person who posted it deleted
                // their account — the plan outlives them, the name does not.
                d.isEnded
                  ? `${d.youCreated ? 'You' : plan.creator?.display_name ?? 'Someone who left'} set this up`
                  : `Hosted by ${d.youCreated ? 'you' : plan.creator?.display_name ?? 'someone who left'}`
              }
              divider={!!plan.location || !!plan.event_date || (d.isLocked && !!plan.locked_date)}
            />
          </Card>
        </Animated.View>

        <PlanPeopleSections d={d} />

        {d.isHost && d.isOpenFlexible && d.viableLead ? (
          <Button
            label={`Lock in ${fmtDay(d.viableLead.date)}`}
            variant="outline"
            onPress={() =>
              Alert.alert(
                `Lock in ${fmtDay(d.viableLead!.date)}?`,
                'This ends the vote and notifies everyone who can make it.',
                [
                  { text: 'Not yet', style: 'cancel' },
                  { text: 'Lock in', onPress: () => lockPlan.mutate(d.viableLead!.id) },
                ]
              )
            }
            testID="lock-in"
          />
        ) : null}
        {d.isHost && d.isLocked && d.isFlexible ? (
          <Button
            label="Reopen the vote"
            variant="outline"
            onPress={() => reopenPlan.mutate()}
            testID="reopen"
          />
        ) : null}
        {!d.isCancelled && !d.isExpired && !d.confirmed ? (
          <Button label="Nudge the rest" variant="outline" onPress={nudge} haptic={false} />
        ) : null}

        {/* PLA-32. Last thing on the screen, under everything the plan is
            asking of you, and only once the night has actually started. The
            component decides for itself whether to render at all: a bystander
            who cannot add photos sees nothing until somebody posts one. */}
        {user ? (
          <PhotoAlbumCard
            planId={String(id)}
            userId={user.id}
            albumOpen={d.albumOpen}
            canAdd={d.canAddPhotos}
          />
        ) : null}

        {/* Guideline 1.2: every piece of user-generated content needs a way to
            report it from the screen it appears on. Quiet by design — this is
            not an action anybody should hit by accident. */}
        <Pressable
          style={({ pressed }) => [styles.reportRow, pressed && styles.pressed]}
          onPress={() =>
            router.push({
              pathname: '/(app)/report',
              params: {
                type: 'plan',
                id: String(id),
                subject: plan.title,
                ...(plan.created_by && plan.created_by !== user?.id
                  ? {
                      personId: plan.created_by,
                      personName: plan.creator?.display_name ?? '',
                    }
                  : {}),
              },
            })
          }
          accessibilityRole="button"
          testID="report-plan"
        >
          <ThemedText variant="caption" color={colors.textMuted}>
            Report this plan
          </ThemedText>
        </Pressable>
      </ScrollView>

      <PlanDetailFooter
        d={d}
        editing={editing}
        picked={picked}
        onAnswer={(response) => answerRsvp.mutate(response)}
        onClearRsvp={() => clearRsvp.mutate()}
        onStartEdit={() => setEditingPicks({ planId: id, picks: d.myPickIds })}
        onSendDates={() => sendDates.mutate(picked)}
        onDeclineAll={() => declineAll.mutate()}
        onRestore={() => restorePlan.mutate()}
        onTryAgain={tryAgain}
        onHeight={setFooterHeight}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  reportRow: {
    alignSelf: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  pressed: {
    opacity: 0.7,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.xl,
    // paddingBottom is measured from the footer at runtime — see footerHeight.
    gap: spacing.xl,
  },
  titleBlock: {
    gap: spacing.sm,
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  swatch: {
    width: 14,
    height: 14,
    borderRadius: 5,
    marginLeft: spacing.xs,
  },
  endedDetails: {
    opacity: 0.7,
  },
});
