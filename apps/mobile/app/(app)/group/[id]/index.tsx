import { useMemo, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Share,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import { isPlanPast, planLastDate } from '@planazo/shared';
import { supabase } from '../../../../lib/supabase';
import { useAuthStore } from '../../../../stores/authStore';
import { ThemedText, Card, Button, AvatarStack, GroupTile } from '../../../../components/ui';
import { colors, fonts, spacing } from '../../../../theme/tokens';

const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export function shareInviteLink(groupName: string, inviteCode: string) {
  return Share.share({
    message: `Join ${groupName} on Planazo: planazo://join/${inviteCode}`,
  }).catch(() => {});
}

export default function GroupDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  // 19d: Past is closed by default — it costs one line until you want it
  const [showPast, setShowPast] = useState(false);

  const { data: group, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['group', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('groups')
        .select(
          `id, name, description, color, invite_code,
          group_members(user_id, role, profile:profiles(id, display_name, avatar_url)),
          plans(id, title, plan_type, status, event_date, locked_date, min_people, created_at,
            cancelled_at, cancelled_by, cancel_reason,
            canceller:profiles!plans_cancelled_by_fkey(display_name),
            rsvps(user_id, response, profile:profiles(display_name)),
            plan_date_options(id, date, date_availability(user_id)))`
        )
        .eq('id', id)
        .single();
      if (error) throw error;
      return data as any;
    },
    enabled: !!id,
  });

  const members = group?.group_members ?? [];
  const myRole = members.find((m: any) => m.user_id === user?.id)?.role;
  const memberNames = members.map((m: any) => m.profile?.display_name ?? '?');

  const planRows = useMemo(() => {
    return (group?.plans ?? []).map((p: any) => {
      let going: number;
      if (p.plan_type === 'fixed' || p.status === 'locked') {
        // Locking a flexible plan seeds yes-RSVPs, so rsvps are the truth here
        going = (p.rsvps ?? []).filter((r: any) => r.response === 'yes').length;
      } else {
        const seen = new Set<string>();
        (p.plan_date_options ?? []).forEach((opt: any) =>
          (opt.date_availability ?? []).forEach((a: any) => seen.add(a.user_id))
        );
        going = seen.size;
      }

      const optionCount = (p.plan_date_options ?? []).length;
      const when = p.locked_date
        ? `${fmtDay(p.locked_date)} · ${fmtTime(p.locked_date)}`
        : p.event_date
          ? `${fmtDay(p.event_date)} · ${fmtTime(p.event_date)}`
          : `${optionCount} date${optionCount === 1 ? '' : 's'} on the table`;

      const meta =
        going < p.min_people ? `${going} of ${p.min_people} needed` : `${going} going`;

      // 19d: three endings, one Past section. A plan that happened keeps its
      // white card and the faces of who was there; the two non-events sink
      // into flat stone with one line of explanation.
      const optionDates = (p.plan_date_options ?? []).map((o: any) => o.date);
      const cancelled = p.status === 'cancelled';
      const past = cancelled || isPlanPast(p, optionDates);
      let ending: 'cancelled' | 'expired' | 'happened' | null = null;
      let endingLine = '';
      if (cancelled) {
        ending = 'cancelled';
        const who =
          p.cancelled_by === user?.id ? 'you' : p.canceller?.display_name ?? 'the host';
        endingLine = `Called off by ${who}`;
      } else if (past) {
        const happened = p.status === 'locked' || going >= p.min_people;
        ending = happened ? 'happened' : 'expired';
        if (!happened) endingLine = `Didn't happen · ${going} of ${p.min_people}`;
      }

      const wentNames = (p.rsvps ?? [])
        .filter((r: any) => r.response === 'yes')
        .map((r: any) =>
          r.user_id === user?.id ? 'You' : r.profile?.display_name ?? '?'
        )
        .sort((a: string, b: string) => (a === 'You' ? -1 : b === 'You' ? 1 : 0));
      const youWent = wentNames[0] === 'You';
      const wentLabel = youWent
        ? wentNames.length === 1
          ? 'You went'
          : `You and ${wentNames.length - 1} other${wentNames.length === 2 ? '' : 's'} went`
        : `${wentNames.length || going} went`;

      const endDate = planLastDate(p, optionDates);

      return {
        id: p.id,
        title: p.title,
        when,
        meta,
        open: p.status === 'open',
        past,
        ending,
        endingLine,
        wentNames,
        wentLabel,
        endDate,
        sortKey: endDate ? new Date(endDate).getTime() : 0,
      };
    });
  }, [group?.plans, user?.id]);

  const live = planRows.filter((p: any) => !p.past);
  const waiting = live.filter((p: any) => p.open);
  const locked = live.filter((p: any) => !p.open);
  const pastRows = planRows
    .filter((p: any) => p.past)
    .sort((a: any, b: any) => b.sortKey - a.sortKey);

  if (isLoading || !group) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  const renderPastRow = (p: any) => {
    const d = p.endDate ? new Date(p.endDate) : null;
    const stone = p.ending !== 'happened';
    return (
      <Pressable
        key={p.id}
        onPress={() => router.push(`/(app)/plan/${p.id}`)}
        style={[styles.pastCard, stone && styles.pastCardStone]}
        testID={`past-row-${p.id}`}
      >
        <View style={[styles.dateTile, stone && styles.dateTileStone]}>
          <ThemedText variant="tag" color={stone ? colors.textMuted : colors.textSecondary} style={styles.dateTileMonth}>
            {d ? d.toLocaleDateString('en-GB', { month: 'short' }) : '—'}
          </ThemedText>
          <ThemedText variant="rowValue" color={stone ? colors.textMuted : colors.textSecondary} style={styles.dateTileDay}>
            {d ? d.getDate() : ''}
          </ThemedText>
        </View>
        <View style={styles.pastBody}>
          <ThemedText
            variant="rowValue"
            color={stone ? colors.textSecondary : colors.textPrimary}
            numberOfLines={1}
          >
            {p.title}
          </ThemedText>
          {p.ending === 'happened' ? (
            <View style={styles.wentRow}>
              <AvatarStack names={p.wentNames} label={p.wentLabel} />
            </View>
          ) : (
            <ThemedText variant="caption" color={colors.textMuted} style={styles.pastLine}>
              {p.endingLine}
            </ThemedText>
          )}
        </View>
      </Pressable>
    );
  };

  const renderPlanRow = (p: any, tone: 'waiting' | 'locked') => (
    <Card key={p.id}>
      <Pressable onPress={() => router.push(`/(app)/plan/${p.id}`)} testID={`plan-row-${p.id}`}>
        <ThemedText variant="cardTitle" style={styles.planTitle} numberOfLines={1}>
          {p.title}
        </ThemedText>
        <ThemedText variant="sub">{p.when}</ThemedText>
        <ThemedText
          variant="caption"
          color={tone === 'waiting' ? colors.accentPressed : colors.textMuted}
          style={styles.planMeta}
        >
          {p.meta}
        </ThemedText>
      </Pressable>
    </Card>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.navRow}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" testID="back">
          <ThemedText variant="bodyStrong" color={colors.accent}>
            ‹ Groups
          </ThemedText>
        </Pressable>
        <Pressable
          onPress={() => router.push(`/(app)/group/${id}/manage`)}
          accessibilityRole="button"
          testID="manage"
        >
          <ThemedText variant="bodyStrong" color={colors.textSecondary}>
            Manage
          </ThemedText>
        </Pressable>
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />}
      >
        <View style={styles.headerBlock}>
          <View style={styles.identityRow}>
            <GroupTile name={group.name} color={group.color} size={52} />
            <View style={styles.identityText}>
              <ThemedText variant="headerTitle">{group.name}</ThemedText>
              <ThemedText variant="caption">
                {myRole === 'admin' ? 'You run this group' : 'You’re a member here'}
              </ThemedText>
            </View>
          </View>

          {group.description ? (
            <ThemedText variant="body" color={colors.textSecondary}>
              {group.description}
            </ThemedText>
          ) : null}

          <View style={styles.facesRow}>
            <AvatarStack
              names={memberNames}
              label={`${members.length} ${members.length === 1 ? 'person' : 'people'}`}
            />
            <Pressable
              onPress={() => router.push(`/(app)/group/${id}/invite`)}
              accessibilityRole="button"
              testID="invite"
            >
              <ThemedText variant="bodyStrong" color={colors.accent}>
                Invite
              </ThemedText>
            </Pressable>
          </View>
        </View>

        {live.length === 0 ? (
          <View style={styles.emptyCard}>
            <ThemedText variant="body" color={colors.textSecondary} style={styles.emptyText}>
              Nothing on yet — start something and it posts straight to {group.name}.
            </ThemedText>
            <Button
              label="Start a plan"
              size="md"
              onPress={() => router.push(`/(app)/plan/create?groupId=${id}`)}
              style={styles.emptyCta}
              testID="start-plan"
            />
          </View>
        ) : (
          <>
            {waiting.length > 0 ? (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <View style={[styles.dot, { backgroundColor: colors.accent }]} />
                  <ThemedText variant="sectionLabel" color={colors.accent}>
                    Waiting on answers · {waiting.length}
                  </ThemedText>
                </View>
                {waiting.map((p: any) => renderPlanRow(p, 'waiting'))}
              </View>
            ) : null}

            {locked.length > 0 ? (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <View style={[styles.dot, { backgroundColor: colors.confirmed }]} />
                  <ThemedText variant="sectionLabel" color={colors.confirmed}>
                    Locked in · {locked.length}
                  </ThemedText>
                </View>
                {locked.map((p: any) => renderPlanRow(p, 'locked'))}
              </View>
            ) : null}
          </>
        )}

        {pastRows.length > 0 ? (
          <View style={styles.section}>
            <Pressable
              onPress={() => setShowPast((s) => !s)}
              accessibilityRole="button"
              style={styles.pastHeader}
              testID="past-toggle"
            >
              <View style={styles.sectionHeader}>
                <ThemedText variant="sectionLabel">Past</ThemedText>
                <ThemedText variant="sectionLabel" color={colors.endedMuted}>
                  {pastRows.length}
                </ThemedText>
              </View>
              <ThemedText variant="caption" color={colors.textMuted}>
                {showPast ? 'Hide ⌃' : 'Show ⌄'}
              </ThemedText>
            </Pressable>
            {showPast ? pastRows.map((p: any) => renderPastRow(p)) : null}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: 14,
    paddingBottom: 6,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: 6,
    paddingBottom: 120,
    gap: spacing.lg,
  },
  headerBlock: {
    gap: spacing.md,
    marginBottom: spacing.xs,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  identityText: {
    flex: 1,
    gap: spacing.xxs,
  },
  facesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    borderRadius: 22,
    padding: 22,
    alignItems: 'center',
    gap: spacing.md,
  },
  emptyText: {
    textAlign: 'center',
  },
  emptyCta: {
    paddingHorizontal: spacing.xxl,
  },
  section: {
    gap: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  planTitle: {
    marginBottom: spacing.xxs,
  },
  planMeta: {
    marginTop: spacing.xs,
  },
  pastHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  // 19d past cards: a happened plan keeps its white card and the faces of
  // who was there; called off and never-quite sink into flat stone.
  pastCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg - 2,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    padding: spacing.lg - 2,
  },
  pastCardStone: {
    backgroundColor: colors.pastCard,
    borderColor: colors.endedBadge,
  },
  dateTile: {
    width: 54,
    height: 58,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.tabBarBorder,
  },
  dateTileStone: {
    backgroundColor: colors.endedBadge,
  },
  dateTileMonth: {
    textTransform: 'uppercase',
    letterSpacing: 0.66,
    opacity: 0.75,
  },
  dateTileDay: {
    fontFamily: fonts.display,
    fontSize: 22,
    lineHeight: 24,
  },
  pastBody: {
    flex: 1,
    gap: 3,
  },
  wentRow: {
    marginTop: spacing.xxs,
  },
  pastLine: {
    fontFamily: fonts.body,
  },
});
