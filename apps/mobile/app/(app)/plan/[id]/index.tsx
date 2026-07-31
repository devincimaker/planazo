import { useMemo, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ActionSheetIOS,
  Alert,
  Platform,
  RefreshControl,
  Share,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeInDown, FadeOutUp, LinearTransition } from 'react-native-reanimated';
import * as Clipboard from 'expo-clipboard';
import {
  countAvailabilityByDate,
  getYesCount,
  isPlanPast,
  planLastDate,
  type DateCount,
} from '@planazo/shared';
import { supabase } from '../../../../lib/supabase';
import { deleteOwnRsvp } from '../../../../lib/rsvp';
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
  showToast,
} from '../../../../components/ui';
import { colors, fonts, radii, spacing } from '../../../../theme/tokens';

const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

// "Cancelled Thursday, 18:20" — weekday while it's fresh, full date after a week
const fmtStamp = (iso: string) => {
  const d = new Date(iso);
  const days = (Date.now() - d.getTime()) / 86400000;
  const day = days < 6.5 ? d.toLocaleDateString('en-GB', { weekday: 'long' }) : fmtDay(iso);
  return `${day}, ${fmtTime(iso)}`;
};

// "Two short on the night" (19c) spells small counts out
const NUM_WORDS = ['No one', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const countWord = (n: number) => NUM_WORDS[n] ?? String(n);

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
        .select(
          '*, creator:profiles!plans_created_by_fkey(display_name), canceller:profiles!plans_cancelled_by_fkey(display_name), groups(id, name, color)'
        )
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

  // Everyone in the circle — the menu's nudge count and 19c's "never
  // answered" line are both "members minus anyone who responded".
  const { data: memberIds } = useQuery({
    queryKey: ['plan-group-member-ids', plan?.group_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('group_members')
        .select('user_id')
        .eq('group_id', plan!.group_id);
      if (error) throw error;
      return (data as { user_id: string }[]).map((m) => m.user_id);
    },
    enabled: !!plan?.group_id,
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
    mutationFn: () => deleteOwnRsvp(id, user!.id),
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
      // Sending dates supersedes a previous "no" — only worth a round-trip
      // (and only safe to assert on) when there is actually a row to clear.
      if ((rsvps ?? []).some((r) => r.user_id === user?.id)) {
        await deleteOwnRsvp(id, user!.id);
      }
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

  // Un-cancel (19b). The RPC restores locked/open, keeps everyone in, and
  // tells them it's back on.
  const restorePlan = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('restore_plan', { p_plan_id: id });
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

    // Endings (19a–19c): past = the end of the plan's last possible day has
    // gone by. Expired ("didn't happen") = past without reaching the minimum.
    // A past plan that reached it simply happened — detail stays as-is (MVP).
    const optionDates = (dateOptions ?? []).map((o) => o.date);
    const isPast = isPlanPast(plan, optionDates);
    const isExpired = isPast && !isCancelled && !confirmed;
    const isEnded = isCancelled || isExpired;
    const lastDate = planLastDate(plan, optionDates);

    let headline: string;
    if (isCancelled) headline = 'Called off';
    else if (isExpired) headline = `${countWord(gap)} short on the night`;
    else if (confirmed) headline = "It's on";
    else if (isOpenFlexible && lead && leadCount > 0)
      headline = `${gap} more on ${fmtDay(lead[1].date)}`;
    else headline = `${gap} more and it's on`;

    const capLine = isExpired
      ? 'The date passed before it reached its minimum'
      : plan.max_people
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

    // Members who never engaged at all — the nudge target (20a) and the
    // "4 never answered" line on 19c.
    const answeredIds = new Set<string>();
    (rsvps ?? []).forEach((r) => {
      if (r.response) answeredIds.add(r.user_id);
    });
    (availabilities ?? []).forEach((a) => answeredIds.add(a.user_id));
    const unanswered = (memberIds ?? []).filter((uid) => !answeredIds.has(uid)).length;

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
      unanswered,
      isHost,
      viableLead,
      isPast,
      isExpired,
      isEnded,
      lastDate,
    };
  }, [plan, rsvps, dateOptions, availabilities, membership, memberIds, user?.id]);

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
  const editing = d.isOpenFlexible && (editingPicks !== null || d.myAvail.length === 0) && !d.userRsvp;
  const picked = editingPicks ?? d.myAvail.map((a) => a.date_option_id);

  const togglePick = (optionId: string) => {
    const base = editingPicks ?? d.myAvail.map((a) => a.date_option_id);
    setEditingPicks(
      base.includes(optionId) ? base.filter((x) => x !== optionId) : [...base, optionId]
    );
  };

  const nudge = () =>
    Share.share({ message: `"${plan.title}" needs answers on Planazo — planazo://plan/${plan.id}` });

  const copyLink = async () => {
    await Clipboard.setStringAsync(`planazo://plan/${plan.id}`);
    showToast('Link copied');
  };

  // 20a: the host menu, guests get it minus "Call it off" (the Edit row is
  // deferred until a plan-edit screen is designed — see tasks.md).
  const showMenu = () => {
    const rows: { label: string; action: () => void; destructive?: boolean }[] = [
      { label: 'Copy invite link', action: copyLink },
    ];
    if (plan.status === 'open' && !d.isPast && d.unanswered > 0) {
      rows.push({
        label: `Nudge the ${d.unanswered} who ${d.unanswered === 1 ? "hasn't" : "haven't"} answered`,
        action: nudge,
      });
    }
    if (d.isHost && !d.isCancelled && !d.isPast) {
      rows.push({
        label: 'Call it off',
        action: () => router.push(`/plan/${id}/cancel`),
        destructive: true,
      });
    }
    if (Platform.OS === 'ios') {
      const destructive = rows.findIndex((r) => r.destructive);
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...rows.map((r) => r.label), 'Cancel'],
          cancelButtonIndex: rows.length,
          destructiveButtonIndex: destructive >= 0 ? destructive : undefined,
        },
        (i) => rows[i]?.action()
      );
    } else {
      Alert.alert('Plan options', undefined, [
        ...rows.map((r) => ({
          text: r.label,
          style: r.destructive ? ('destructive' as const) : undefined,
          onPress: r.action,
        })),
        { text: 'Close', style: 'cancel' as const },
      ]);
    }
  };

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

  const renderFooter = () => {
    // 19b: reopen lives on the host's cancelled screen only, and only while
    // the date is still ahead. Everyone else gets no footer at all — the
    // screen is purely a record.
    if (d.isCancelled) {
      if (d.isHost && !d.isPast) {
        return (
          <View style={styles.footerEnded}>
            <Button
              label="Reopen this plan"
              variant="accentOutline"
              onPress={() => restorePlan.mutate()}
              testID="restore"
            />
            <ThemedText variant="caption" color={colors.textMuted} style={styles.footerNote}>
              Everyone who was in stays in — they just get told it's back on. Only you see this
              {d.lastDate ? `, and only until ${fmtDay(d.lastDate)}` : ''}.
            </ThemedText>
          </View>
        );
      }
      return null;
    }

    // 19c: anyone in the circle can try again — a copy, not a handover.
    if (d.isExpired) {
      return (
        <View style={styles.footerEnded}>
          <Button
            label="Try again with a new date"
            variant="accentOutline"
            onPress={tryAgain}
            testID="try-again"
          />
          <ThemedText variant="caption" color={colors.textMuted} style={styles.footerNote}>
            Opens a fresh plan with the same title, place and minimum.
          </ThemedText>
        </View>
      );
    }

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

  // 19a: the footer bar is removed, not emptied — no bar at all when there
  // is nothing to press.
  const footerContent = renderFooter();

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topBar}>
        {/* Deep links (push, QA) mount this as the first screen — fall back
            to where the label points */}
        <Pressable
          onPress={() =>
            router.canGoBack()
              ? router.back()
              : router.replace(plan.group_id ? `/(app)/group/${plan.group_id}` : '/(app)/(tabs)')
          }
          accessibilityRole="button"
          testID="back"
        >
          <ThemedText variant="bodyStrong" color={colors.accent}>
            ‹ {groupName}
          </ThemedText>
        </Pressable>
        <Pressable onPress={showMenu} accessibilityRole="button" accessibilityLabel="Plan options" testID="plan-menu">
          <ThemedText variant="bodyStrong" color={colors.textMuted} style={styles.dots}>
            ···
          </ThemedText>
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />}
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

        {d.isCancelled ? (
          // 19a/19b: the count is gone — a flat stone card carries the two
          // facts that matter: it's off, and why.
          <Card style={styles.endedCard}>
            <View style={styles.endedCardInner}>
              <ThemedText variant="statusHeadline" color={colors.textPrimary}>
                {plan.cancelled_by === user?.id
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
                  {plan.cancelled_by === user?.id
                    ? fmtStamp(plan.cancelled_at)
                    : `Cancelled ${fmtStamp(plan.cancelled_at)}`}
                </ThemedText>
              ) : null}
            </View>
          </Card>
        ) : d.isExpired ? (
          // 19c: the slot bar stays, frozen — here the count is the explanation.
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
        ) : (
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
        )}

        {d.isOpenFlexible && !d.isPast ? (
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
                d.isEnded
                  ? `${plan.created_by === user?.id ? 'You' : plan.creator?.display_name ?? '?'} set this up`
                  : `Hosted by ${d.isHost ? 'you' : plan.creator?.display_name ?? '?'}`
              }
              divider={!!plan.location || !!plan.event_date || (d.isLocked && !!plan.locked_date)}
            />
          </Card>
        </Animated.View>

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
          {d.isExpired && (d.unanswered > 0 || d.outCount > 0) ? (
            <ThemedText variant="caption" color={colors.textMuted}>
              {[
                d.unanswered > 0 ? `${d.unanswered} never answered` : null,
                d.outCount > 0 ? `${d.outCount} couldn't make it` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </ThemedText>
          ) : !d.isEnded && d.outCount > 0 ? (
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
        {!d.isCancelled && !d.isExpired && !d.confirmed ? (
          <Button label="Nudge the rest" variant="outline" onPress={nudge} haptic={false} />
        ) : null}
      </ScrollView>

      {footerContent ? <View style={styles.footer}>{footerContent}</View> : null}
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
  personEnded: {
    backgroundColor: colors.surfaceSunken,
    borderColor: colors.endedBorder,
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
  endedDetails: {
    opacity: 0.7,
  },
  footerEnded: {
    gap: spacing.sm + 1,
  },
  footerNote: {
    textAlign: 'center',
    fontFamily: fonts.body,
    lineHeight: 18,
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
