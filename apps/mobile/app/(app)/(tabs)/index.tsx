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
  needsUserResponse,
} from '@planazo/shared';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../stores/authStore';
import {
  ThemedText,
  Card,
  Chip,
  Badge,
  Avatar,
  AvatarStack,
  AnswerFooter,
  Button,
  DateOptionRow,
  EmptyState,
  colorForName,
} from '../../../components/ui';
import { colors, spacing } from '../../../theme/tokens';

type Filter = 'all' | 'needs' | 'happening';

const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export default function FeedScreen() {
  const { profile, user } = useAuthStore();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');
  // Local date selections per flexible plan, committed on "Send N dates"
  const [pickedDates, setPickedDates] = useState<Record<string, string[]>>({});

  const { data: plans, isLoading, refetch, isRefetching } = useQuery({
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

  const answerFixed = useMutation({
    mutationFn: async ({ planId, response }: { planId: string; response: 'yes' | 'no' }) => {
      const { error } = await supabase.from('rsvps').upsert(
        { plan_id: planId, user_id: user?.id, response },
        { onConflict: 'plan_id,user_id' }
      );
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (error: Error) => Alert.alert('Error', error.message),
  });

  const clearAnswer = useMutation({
    mutationFn: async (planId: string) => {
      const { error } = await supabase
        .from('rsvps')
        .delete()
        .eq('plan_id', planId)
        .eq('user_id', user!.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (error: Error) => Alert.alert('Error', error.message),
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
    onError: (error: Error) => Alert.alert('Error', error.message),
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
    onError: (error: Error) => Alert.alert('Error', error.message),
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

      let when: string;
      if (plan.locked_date) {
        when = `${fmtDay(plan.locked_date)} · ${fmtTime(plan.locked_date)}`;
      } else if (plan.event_date) {
        when = `${fmtDay(plan.event_date)} · ${fmtTime(plan.event_date)}`;
      } else {
        when = `${dateOptions.length} date${dateOptions.length === 1 ? '' : 's'} on the table`;
      }

      let goingNames: string[];
      if (plan.plan_type === 'fixed') {
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

      return {
        plan,
        confirmed,
        needs,
        userRsvp,
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
    const filtered = decorated.filter((d) =>
      filter === 'needs' ? d.needs : filter === 'happening' ? d.confirmed : true
    );
    return filtered.sort((a, b) =>
      a.needs !== b.needs ? (a.needs ? -1 : 1) : a.sortKey - b.sortKey
    );
  }, [decorated, filter]);

  const openPlan = (planId: string) => router.push(`/(app)/plan/${planId}`);

  const renderAnswer = (d: (typeof decorated)[number]) => {
    const { plan } = d;
    if (plan.status !== 'open') return null;

    if (plan.plan_type === 'fixed') {
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
        <View style={styles.chipButtons}>
          <Button
            label="Can't make it"
            variant="secondary"
            size="md"
            onPress={() => declineFlexible.mutate({ planId: plan.id, optionIds: d.optionIds })}
            style={styles.noButton}
          />
          {picked.length === 0 ? (
            <Button
              label="Tap the dates you can do"
              variant="secondary"
              size="md"
              disabled
              haptic={false}
              style={styles.sendButton}
            />
          ) : (
            <Button
              label={`Send ${picked.length} date${picked.length === 1 ? '' : 's'}`}
              size="md"
              onPress={() => sendDates.mutate({ planId: plan.id, optionIds: picked })}
              style={styles.sendButton}
            />
          )}
        </View>
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
        >
          <Avatar name={profile?.display_name ?? '?'} dark size={36} imageUrl={profile?.avatar_url} />
        </Pressable>
      </View>

      <View style={styles.filters}>
        <Chip label="All" active={filter === 'all'} onPress={() => setFilter('all')} />
        <Chip label="Needs you" active={filter === 'needs'} onPress={() => setFilter('needs')} />
        <Chip
          label="Confirmed"
          active={filter === 'happening'}
          onPress={() => setFilter('happening')}
        />
      </View>

      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />}
        >
          {visible.length === 0 ? (
            <EmptyState
              title={filter === 'needs' ? 'Nothing to answer' : 'Nothing on the table'}
              body={
                filter === 'needs'
                  ? 'When someone in a group proposes a plan, it lands here.'
                  : 'Start something — pick a group, throw out a date or a few, and see who bites.'
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
                      <Badge
                        label={d.needs ? 'Needs you' : d.confirmed ? 'Confirmed' : 'Open'}
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
  filters: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
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
    flexDirection: 'row',
    gap: 10,
    marginTop: spacing.xxs,
  },
  noButton: {
    flexBasis: 118,
    flexGrow: 0,
  },
  sendButton: {
    flex: 1,
  },
});
