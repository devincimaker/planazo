import { useMemo } from 'react';
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
import { supabase } from '../../../../lib/supabase';
import { useAuthStore } from '../../../../stores/authStore';
import { ThemedText, Card, Button, AvatarStack, GroupTile } from '../../../../components/ui';
import { colors, spacing } from '../../../../theme/tokens';

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

  const { data: group, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['group', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('groups')
        .select(
          `id, name, description, color, invite_code,
          group_members(user_id, role, profile:profiles(id, display_name, avatar_url)),
          plans(id, title, plan_type, status, event_date, locked_date, min_people, created_at,
            rsvps(user_id, response), plan_date_options(id, date, date_availability(user_id)))`
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
    return (group?.plans ?? [])
      .filter((p: any) => p.status !== 'cancelled')
      .map((p: any) => {
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

        return { id: p.id, title: p.title, when, meta, open: p.status === 'open' };
      });
  }, [group?.plans]);

  const waiting = planRows.filter((p: any) => p.open);
  const locked = planRows.filter((p: any) => !p.open);

  if (isLoading || !group) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

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

        {planRows.length === 0 ? (
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
});
