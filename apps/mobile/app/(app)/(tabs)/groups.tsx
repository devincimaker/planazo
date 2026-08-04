import {
  View,
  ScrollView,
  StyleSheet,
  RefreshControl,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import { flattenNestedOptions, needsUserResponse } from '@planazo/shared';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../stores/authStore';
import { useFriends } from '../../../lib/useFriends';
import { errorCopy } from '../../../lib/queryErrors';
import { usePullToRefresh } from '../../../lib/usePullToRefresh';
import { MIN_TOUCH_TARGET } from '../../../lib/a11y';
import { ThemedText, Card, AvatarStack, GroupTile, ErrorState } from '../../../components/ui';
import { GroupsEmptyState } from '../../../components/group/GroupsEmptyState';
import { InvitesRow } from '../../../components/group/InvitesRow';
import { colors, fonts, radii, spacing } from '../../../theme/tokens';

interface GroupRow {
  id: string;
  role: string;
  name: string;
  color: string | null;
  imageUrl: string | null;
  members: number;
  needsYou: number;
}

export default function GroupsScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { friends } = useFriends();

  const { data: rows, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['groups', user?.id],
    queryFn: async (): Promise<GroupRow[]> => {
      const { data: memberships, error } = await supabase
        .from('group_members')
        .select('group_id, role, groups:group_id(id, name, color, image_url, created_at)')
        .eq('user_id', user!.id);
      if (error) throw error;

      const groupIds = (memberships ?? []).map((m) => m.group_id);
      if (groupIds.length === 0) return [];

      const [countsRes, plansRes] = await Promise.all([
        supabase.from('group_members').select('group_id').in('group_id', groupIds),
        supabase
          .from('plans')
          .select(
            `id, group_id, plan_type, status, min_people,
            rsvps(user_id, response),
            plan_date_options(id, date, date_availability(user_id))`
          )
          .in('group_id', groupIds)
          .eq('status', 'open'),
      ]);
      if (countsRes.error) throw countsRes.error;
      if (plansRes.error) throw plansRes.error;

      const memberCount: Record<string, number> = {};
      (countsRes.data ?? []).forEach((c) => {
        memberCount[c.group_id] = (memberCount[c.group_id] ?? 0) + 1;
      });

      const needsCount: Record<string, number> = {};
      (plansRes.data ?? []).forEach((plan: any) => {
        const { availabilities } = flattenNestedOptions(plan.plan_date_options);
        const needs = needsUserResponse(
          {
            plan_type: plan.plan_type,
            status: plan.status,
            rsvps: plan.rsvps,
            availabilities,
          },
          user?.id
        );
        if (needs) needsCount[plan.group_id] = (needsCount[plan.group_id] ?? 0) + 1;
      });

      return (memberships ?? [])
        .map((m: any) => ({
          id: m.group_id,
          role: m.role,
          name: m.groups?.name ?? 'Group',
          color: m.groups?.color ?? null,
          imageUrl: m.groups?.image_url ?? null,
          createdAt: m.groups?.created_at ?? '',
          members: memberCount[m.group_id] ?? 0,
          needsYou: needsCount[m.group_id] ?? 0,
        }))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    enabled: !!user,
  });
  const { refreshing, onRefresh } = usePullToRefresh(refetch);

  const hasGroups = (rows ?? []).length > 0;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <ThemedText variant="headerTitle">Groups</ThemedText>
        {hasGroups ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/(app)/find-people')}
            style={({ pressed }) => [styles.findPill, pressed && styles.pressed]}
            testID="find-people"
          >
            <View style={styles.findIcon}>
              <View style={styles.findCircle} />
              <View style={styles.findHandle} />
            </View>
            <ThemedText variant="bodyStrong" style={styles.findLabel}>
              Find people
            </ThemedText>
          </Pressable>
        ) : null}
      </View>

      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : isError ? (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.errorContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <ErrorState {...errorCopy(error)} onRetry={() => refetch()} testID="groups-error" />
        </ScrollView>
      ) : !hasGroups ? (
        <GroupsEmptyState />
      ) : (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <InvitesRow />

          <View style={styles.sectionHeader}>
            <ThemedText variant="sectionLabel">Your groups</ThemedText>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/(app)/group/new')}
              testID="new-group"
              style={styles.sectionAction}
            >
              <ThemedText variant="bodyStrong" color={colors.accent}>
                New
              </ThemedText>
            </Pressable>
          </View>
          <Card padded={false}>
            {(rows ?? []).map((g, i) => (
              <Pressable
                key={g.id}
                accessibilityRole="button"
                onPress={() => router.push(`/(app)/group/${g.id}`)}
                style={({ pressed }) => [
                  styles.row,
                  i > 0 && styles.rowDivider,
                  pressed && styles.rowPressed,
                ]}
                testID={`group-row-${g.id}`}
              >
                <GroupTile name={g.name} color={g.color} imageUrl={g.imageUrl} size={42} />
                <View style={styles.rowBody}>
                  <ThemedText variant="bodyStrong" style={styles.rowName} numberOfLines={1}>
                    {g.name}
                  </ThemedText>
                  <View style={styles.rowMeta}>
                    <ThemedText variant="caption">
                      {g.members} {g.members === 1 ? 'person' : 'people'}
                    </ThemedText>
                    {g.needsYou > 0 ? (
                      <ThemedText variant="caption" color={colors.accent}>
                        {' · '}
                        {g.needsYou} plan{g.needsYou === 1 ? '' : 's'} waiting on you
                      </ThemedText>
                    ) : null}
                  </View>
                </View>
                <ThemedText variant="body" color={colors.textFaint}>
                  ›
                </ThemedText>
              </Pressable>
            ))}
          </Card>

          {friends.length > 0 ? (
            <View style={styles.peopleSection}>
              <ThemedText variant="sectionLabel" style={styles.sectionLabel}>
                Your people
              </ThemedText>
              <Card padded={false}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push('/(app)/find-people')}
                  style={({ pressed }) => [styles.peopleRow, pressed && styles.rowPressed]}
                  testID="your-people"
                >
                  <AvatarStack names={friends.map((f) => f.name)} max={4} size={30} />
                  <ThemedText variant="bodyStrong" style={styles.peopleLabel}>
                    {friends.length} friend{friends.length === 1 ? '' : 's'}
                  </ThemedText>
                  <ThemedText variant="body" color={colors.textFaint}>
                    ›
                  </ThemedText>
                </Pressable>
              </Card>
            </View>
          ) : null}
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
    // 4 of the 7 the pill grew by (PLA-40) come back out of the row, so the
    // header goes 61 → 60 rather than 61 → 68.
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  findPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET,
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: radii.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: 14,
  },
  findIcon: {
    width: 15,
    height: 14,
  },
  findCircle: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 11,
    height: 11,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.ink,
  },
  findHandle: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 8,
    height: 2,
    backgroundColor: colors.ink,
    transform: [{ rotate: '45deg' }],
  },
  findLabel: {
    fontSize: 14,
    lineHeight: 18,
    fontFamily: fonts.bodyBold,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  // "New" is a ~30×20 word with nothing around it. The box is a real 44×44 —
  // it grows leftwards (so `space-between` keeps the word flush right) and the
  // negative margin keeps the section header its original 20pt (PLA-40).
  sectionAction: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    marginVertical: -(MIN_TOUCH_TARGET - 20) / 2,
  },
  peopleSection: {
    marginTop: 22,
  },
  peopleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
  },
  peopleLabel: {
    flex: 1,
  },
  pressed: {
    opacity: 0.8,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContent: {
    flexGrow: 1,
    paddingBottom: 120,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: 120,
  },
  sectionLabel: {
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
  },
  rowDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  rowPressed: {
    backgroundColor: colors.surfaceSunken,
  },
  rowBody: {
    flex: 1,
    gap: spacing.xxs,
  },
  rowName: {
    fontSize: 16,
    lineHeight: 20,
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
