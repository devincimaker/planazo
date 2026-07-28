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
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeInDown, FadeOutUp, LinearTransition } from 'react-native-reanimated';
import {
  countAvailabilityByDate,
  getYesCount,
  type DateCount,
} from '@planazo/shared';
import { supabase } from '../../../../lib/supabase';
import { useAuthStore } from '../../../../stores/authStore';
import {
  ThemedText,
  Card,
  Badge,
  Avatar,
  AnswerFooter,
  Button,
  SlotBar,
  ListRow,
  colorForName,
} from '../../../../components/ui';
import { colors, fonts, radii, spacing } from '../../../../theme/tokens';

const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export default function PlanDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  // null = not editing dates; array = local picks being edited
  const [editingPicks, setEditingPicks] = useState<string[] | null>(null);

  const { data: plan, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['plan', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('plans')
        .select('*, creator:profiles!plans_created_by_fkey(display_name), groups(id, name)')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data as any;
    },
    enabled: !!id,
  });

  const { data: rsvps } = useQuery({
    queryKey: ['plan-rsvps', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rsvps')
        .select('*, profile:profiles(display_name)')
        .eq('plan_id', id);
      if (error) throw error;
      return data as any[];
    },
    enabled: !!id,
  });

  const { data: dateOptions } = useQuery({
    queryKey: ['plan-date-options', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('plan_date_options')
        .select('*')
        .eq('plan_id', id)
        .order('date', { ascending: true });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!id && plan?.plan_type === 'flexible',
  });

  const { data: availabilities } = useQuery({
    queryKey: ['plan-availabilities', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('date_availability')
        .select('*, profile:profiles(display_name)')
        .eq('plan_id', id);
      if (error) throw error;
      return data as any[];
    },
    enabled: !!id && plan?.plan_type === 'flexible',
  });

  const { data: membership } = useQuery({
    queryKey: ['plan-membership', plan?.group_id, user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('group_members')
        .select('role')
        .eq('group_id', plan!.group_id)
        .eq('user_id', user!.id)
        .single();
      return data;
    },
    enabled: !!plan?.group_id && !!user,
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['plan', id] });
    queryClient.invalidateQueries({ queryKey: ['plan-rsvps', id] });
    queryClient.invalidateQueries({ queryKey: ['plan-availabilities', id] });
    queryClient.invalidateQueries({ queryKey: ['home-plans'] });
    if (plan?.group_id) {
      queryClient.invalidateQueries({ queryKey: ['group-plans', plan.group_id] });
    }
  };

  const answerRsvp = useMutation({
    mutationFn: async (response: 'yes' | 'no') => {
      const { error } = await supabase.from('rsvps').upsert(
        { plan_id: id, user_id: user?.id, response },
        { onConflict: 'plan_id,user_id' }
      );
      if (error) throw error;
    },
    onSuccess: invalidateAll,
    onError: (error: Error) => Alert.alert('Error', error.message),
  });

  const clearRsvp = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('rsvps')
        .delete()
        .eq('plan_id', id)
        .eq('user_id', user!.id);
      if (error) throw error;
    },
    onSuccess: invalidateAll,
    onError: (error: Error) => Alert.alert('Error', error.message),
  });

  const sendDates = useMutation({
    mutationFn: async (picked: string[]) => {
      const mine = (availabilities ?? []).filter((a) => a.user_id === user?.id);
      const removed = mine.filter((a) => !picked.includes(a.date_option_id)).map((a) => a.id);

      if (picked.length > 0) {
        const rows = picked.map((optionId) => ({
          plan_id: id,
          user_id: user?.id,
          date_option_id: optionId,
          available: true,
        }));
        const { error } = await supabase
          .from('date_availability')
          .upsert(rows, { onConflict: 'plan_id,user_id,date_option_id' });
        if (error) throw error;
      }
      if (removed.length > 0) {
        const { error } = await supabase.from('date_availability').delete().in('id', removed);
        if (error) throw error;
      }
      // Sending dates supersedes a previous "no"
      await supabase.from('rsvps').delete().eq('plan_id', id).eq('user_id', user!.id);
    },
    onSuccess: () => {
      setEditingPicks(null);
      invalidateAll();
    },
    onError: (error: Error) => Alert.alert('Error', error.message),
  });

  const declineAll = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('rsvps').upsert(
        { plan_id: id, user_id: user?.id, response: 'no' },
        { onConflict: 'plan_id,user_id' }
      );
      if (error) throw error;
      const mine = (availabilities ?? []).filter((a) => a.user_id === user?.id);
      if (mine.length > 0) {
        const { error: availError } = await supabase
          .from('date_availability')
          .delete()
          .in('id', mine.map((a) => a.id));
        if (availError) throw availError;
      }
    },
    onSuccess: () => {
      setEditingPicks(null);
      invalidateAll();
    },
    onError: (error: Error) => Alert.alert('Error', error.message),
  });

  const lockPlan = useMutation({
    mutationFn: async (dateOptionId: string) => {
      const { data, error } = await supabase.rpc('lock_plan', {
        p_plan_id: id,
        p_date_option_id: dateOptionId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: invalidateAll,
    onError: (error: Error) => Alert.alert('Error', error.message),
  });

  const reopenPlan = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('reopen_plan', { p_plan_id: id });
      if (error) throw error;
    },
    onSuccess: invalidateAll,
    onError: (error: Error) => Alert.alert('Error', error.message),
  });

  const cancelPlan = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('cancel_plan', { p_plan_id: id });
      if (error) throw error;
    },
    onSuccess: invalidateAll,
    onError: (error: Error) => Alert.alert('Error', error.message),
  });

  const derived = useMemo(() => {
    if (!plan) return null;
    const isFlexible = plan.plan_type === 'flexible';
    const isLocked = plan.status === 'locked';
    const isCancelled = plan.status === 'cancelled';
    const isOpenFlexible = isFlexible && plan.status === 'open';

    const yesCount = getYesCount(rsvps);
    const countByDate: Record<string, DateCount> = countAvailabilityByDate(
      (dateOptions ?? []).map((o) => ({ id: o.id, date: o.date })),
      (availabilities ?? []).map((a) => ({ date_option_id: a.date_option_id, user_id: a.user_id }))
    );

    // Leading option: most availability, ties to the earlier date
    const lead = Object.entries(countByDate).sort(
      (a, b) =>
        b[1].count - a[1].count ||
        new Date(a[1].date).getTime() - new Date(b[1].date).getTime()
    )[0];
    const leadCount = lead?.[1].count ?? 0;

    const going = isOpenFlexible ? leadCount : yesCount;
    const confirmed = !isCancelled && (isLocked || going >= plan.min_people);
    const gap = plan.min_people - going;

    let headline: string;
    if (isCancelled) headline = 'Called off';
    else if (confirmed) headline = "It's on";
    else if (isOpenFlexible && lead && leadCount > 0)
      headline = `${gap} more on ${fmtDay(lead[1].date)}`;
    else headline = `${gap} more and it's on`;

    const capLine = plan.max_people
      ? confirmed
        ? `${going} in · room for ${Math.max(plan.max_people - going, 0)} more`
        : `Happens with ${plan.min_people} · caps at ${plan.max_people}`
      : `Happens with ${plan.min_people}`;

    const myAvail = (availabilities ?? []).filter((a) => a.user_id === user?.id);
    const userRsvp = (rsvps ?? []).find((r) => r.user_id === user?.id);

    const goingPeople: { id: string; name: string }[] = [];
    const seen = new Set<string>();
    const pushPerson = (uid: string, name: string) => {
      if (uid === user?.id || seen.has(uid)) return;
      seen.add(uid);
      goingPeople.push({ id: uid, name });
    };
    if (isOpenFlexible) {
      (availabilities ?? []).forEach((a) => pushPerson(a.user_id, a.profile?.display_name ?? '?'));
    } else {
      (rsvps ?? [])
        .filter((r) => r.response === 'yes')
        .forEach((r) => pushPerson(r.user_id, r.profile?.display_name ?? '?'));
    }
    const youIn = isOpenFlexible ? myAvail.length > 0 : userRsvp?.response === 'yes';

    const outCount = (rsvps ?? []).filter((r) => r.response === 'no').length;

    const isHost = plan.created_by === user?.id || membership?.role === 'admin';
    const viableLead = lead && leadCount >= plan.min_people ? { id: lead[0], ...lead[1] } : null;

    return {
      isFlexible,
      isLocked,
      isCancelled,
      isOpenFlexible,
      confirmed,
      headline,
      capLine,
      going,
      yesCount,
      countByDate,
      leadId: lead?.[0] ?? null,
      myAvail,
      userRsvp,
      goingPeople,
      youIn,
      outCount,
      isHost,
      viableLead,
    };
  }, [plan, rsvps, dateOptions, availabilities, membership, user?.id]);

  if (isLoading || !plan || !derived) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  const d = derived;
  const groupName = plan.groups?.name ?? 'Group';
  const groupColor = colorForName(groupName);
  const editing = d.isOpenFlexible && (editingPicks !== null || d.myAvail.length === 0) && !d.userRsvp;
  const picked = editingPicks ?? d.myAvail.map((a) => a.date_option_id);

  const togglePick = (optionId: string) => {
    const base = editingPicks ?? d.myAvail.map((a) => a.date_option_id);
    setEditingPicks(
      base.includes(optionId) ? base.filter((x) => x !== optionId) : [...base, optionId]
    );
  };

  const showMenu = () => {
    Alert.alert('Plan options', undefined, [
      {
        text: 'Cancel plan',
        style: 'destructive',
        onPress: () =>
          Alert.alert('Cancel this plan?', 'Everyone who answered will be notified.', [
            { text: 'Keep it', style: 'cancel' },
            { text: 'Cancel plan', style: 'destructive', onPress: () => cancelPlan.mutate() },
          ]),
      },
      { text: 'Close', style: 'cancel' },
    ]);
  };

  const nudge = () =>
    Share.share({ message: `"${plan.title}" needs answers on Planazo — planazo://plan/${plan.id}` });

  const statusBadge = d.isCancelled
    ? { label: 'Cancelled', tone: 'muted' as const }
    : d.confirmed
      ? { label: 'Confirmed', tone: 'confirmed' as const }
      : { label: 'Open', tone: 'open' as const };

  const renderFooter = () => {
    if (d.isCancelled) return null;

    if (!d.isOpenFlexible) {
      // Fixed plans and locked flexible plans: a plain yes/no
      if (d.userRsvp?.response === 'yes' || d.userRsvp?.response === 'no') {
        return (
          <AnswerFooter answered={d.userRsvp.response} onChange={() => clearRsvp.mutate()} />
        );
      }
      return (
        <AnswerFooter
          onYes={() => answerRsvp.mutate('yes')}
          onNo={() => answerRsvp.mutate('no')}
        />
      );
    }

    // Open flexible: date voting
    if (!editing) {
      if (d.userRsvp?.response === 'no') {
        return <AnswerFooter answered="no" onChange={() => clearRsvp.mutate()} />;
      }
      return (
        <AnswerFooter
          answered="yes"
          answerLabel={`You sent ${d.myAvail.length} date${d.myAvail.length === 1 ? '' : 's'}`}
          onChange={() => setEditingPicks(d.myAvail.map((a) => a.date_option_id))}
        />
      );
    }

    return (
      <View style={styles.footerRow}>
        <Button
          label="None of them"
          variant="secondary"
          onPress={() => declineAll.mutate()}
          style={styles.footerNo}
        />
        {picked.length === 0 ? (
          <Button
            label="Tap the dates you can do"
            variant="secondary"
            disabled
            haptic={false}
            style={styles.footerYes}
          />
        ) : (
          <Button
            label={
              d.myAvail.length > 0
                ? 'Update your dates'
                : `Send ${picked.length} date${picked.length === 1 ? '' : 's'}`
            }
            onPress={() => sendDates.mutate(picked)}
            style={styles.footerYes}
          />
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" testID="back">
          <ThemedText variant="bodyStrong" color={colors.accent}>
            ‹ {groupName}
          </ThemedText>
        </Pressable>
        {d.isHost ? (
          <Pressable onPress={showMenu} accessibilityRole="button" accessibilityLabel="Plan options" testID="plan-menu">
            <ThemedText variant="bodyStrong" color={colors.textMuted} style={styles.dots}>
              ···
            </ThemedText>
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />}
      >
        <View style={styles.titleBlock}>
          <View style={styles.chipRow}>
            <Badge label={statusBadge.label} tone={statusBadge.tone} uppercase />
            <View style={[styles.swatch, { backgroundColor: groupColor }]} />
            <ThemedText variant="caption">{groupName}</ThemedText>
          </View>
          <ThemedText variant="screenTitle">{plan.title}</ThemedText>
          {plan.description ? <ThemedText variant="sub">{plan.description}</ThemedText> : null}
        </View>

        <Card>
          <View style={styles.statusTop}>
            <ThemedText
              variant="statusHeadline"
              color={d.isCancelled ? colors.textMuted : d.confirmed ? colors.confirmed : colors.accent}
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

        {d.isOpenFlexible ? (
          <Animated.View
            entering={FadeInDown}
            exiting={FadeOutUp}
            layout={LinearTransition}
            style={styles.section}
          >
            <ThemedText variant="sectionLabel">Which days work</ThemedText>
            {(dateOptions ?? []).map((opt) => {
              const count = d.countByDate[opt.id]?.count ?? 0;
              const mine = picked.includes(opt.id);
              const isLead = opt.id === d.leadId && count > 0;
              const ratio = Math.min(count / plan.min_people, 1);
              return (
                <Pressable
                  key={opt.id}
                  onPress={() => togglePick(opt.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: mine }}
                  testID={`vote-${opt.id}`}
                  style={[styles.dateCard, mine && styles.dateCardMine]}
                >
                  <View style={styles.dateTop}>
                    <View style={styles.dateLabelRow}>
                      <ThemedText
                        variant="bodyStrong"
                        color={mine ? colors.accentPressed : colors.textPrimary}
                        style={styles.dateLabel}
                      >
                        {fmtDay(opt.date)}
                      </ThemedText>
                      {isLead ? <Badge label="Leading" tone="muted" uppercase /> : null}
                    </View>
                    <View style={styles.dateMetaRow}>
                      <ThemedText variant="caption" color={mine ? colors.accentPressed : colors.textMuted}>
                        {count} free
                      </ThemedText>
                      <ThemedText variant="bodyStrong" color={colors.accent} style={styles.mark}>
                        {mine ? '✓' : ''}
                      </ThemedText>
                    </View>
                  </View>
                  <View style={styles.track}>
                    <View
                      style={[
                        styles.trackFill,
                        {
                          width: `${Math.round(ratio * 100)}%`,
                          backgroundColor:
                            count >= plan.min_people ? colors.confirmed : colors.accent,
                        },
                      ]}
                    />
                  </View>
                </Pressable>
              );
            })}
          </Animated.View>
        ) : null}

        <Animated.View layout={LinearTransition}>
          <Card padded={false}>
            {d.isLocked && plan.locked_date ? (
              <Animated.View entering={FadeInDown}>
                <ListRow title={fmtDay(plan.locked_date)} value={fmtTime(plan.locked_date)} />
              </Animated.View>
            ) : null}
            {plan.event_date ? (
              <ListRow title={fmtDay(plan.event_date)} value={fmtTime(plan.event_date)} />
            ) : null}
            {plan.location ? (
              <ListRow
                title={plan.location}
                divider={!!plan.event_date || (d.isLocked && !!plan.locked_date)}
                right={
                  <ThemedText variant="bodyStrong" color={colors.accent}>
                    Map
                  </ThemedText>
                }
              />
            ) : null}
            <ListRow
              title={`Hosted by ${d.isHost ? 'you' : plan.creator?.display_name ?? '?'}`}
              divider={!!plan.location || !!plan.event_date || (d.isLocked && !!plan.locked_date)}
            />
          </Card>
        </Animated.View>

        <View style={styles.section}>
          <ThemedText variant="sectionLabel">
            {d.isOpenFlexible ? 'In the mix' : 'Going'}
          </ThemedText>
          <View style={styles.people}>
            {d.youIn ? (
              <View style={[styles.person, styles.personYou]}>
                <Avatar name="You" dark size={26} />
                <ThemedText variant="bodyStrong" color={colors.accentPressed}>
                  You
                </ThemedText>
              </View>
            ) : null}
            {d.goingPeople.map((p) => (
              <View key={p.id} style={styles.person}>
                <Avatar name={p.name} size={26} />
                <ThemedText variant="bodyStrong">{p.name}</ThemedText>
              </View>
            ))}
          </View>
          {d.outCount > 0 ? (
            <ThemedText variant="caption" color={colors.textFaint}>
              {d.outCount} can't make it
            </ThemedText>
          ) : null}
        </View>

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
        {!d.isCancelled && !d.confirmed ? (
          <Button label="Nudge the rest" variant="outline" onPress={nudge} haptic={false} />
        ) : null}
      </ScrollView>

      <View style={styles.footer}>{renderFooter()}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  dots: {
    letterSpacing: 2,
    fontSize: 19,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingBottom: 150,
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
  section: {
    gap: spacing.sm,
  },
  dateCard: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 20,
    padding: spacing.lg,
    gap: 9,
  },
  dateCardMine: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  dateTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dateLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dateLabel: {
    fontSize: 16,
  },
  dateMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  mark: {
    width: 14,
    textAlign: 'center',
  },
  track: {
    height: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.divider,
    overflow: 'hidden',
  },
  trackFill: {
    height: 6,
    borderRadius: radii.pill,
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
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.tabBarBackground,
    borderTopWidth: 1,
    borderTopColor: colors.tabBarBorder,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: 30,
  },
  footerRow: {
    flexDirection: 'row',
    gap: 10,
  },
  footerNo: {
    flexBasis: 130,
    flexGrow: 0,
  },
  footerYes: {
    flex: 1,
  },
});
