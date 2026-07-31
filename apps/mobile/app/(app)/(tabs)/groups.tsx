import { useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  RefreshControl,
  Pressable,
  ActivityIndicator,
  Alert,
  TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import { flattenNestedOptions, needsUserResponse } from '@planazo/shared';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../stores/authStore';
import { usePendingInvites } from '../../../lib/usePendingInvites';
import { useFriends } from '../../../lib/useFriends';
import { errorCopy } from '../../../lib/queryErrors';
import {
  ThemedText,
  Card,
  Button,
  Avatar,
  AvatarStack,
  GroupTile,
  ErrorState,
} from '../../../components/ui';
import { colors, fonts, radii, spacing, groupColors } from '../../../theme/tokens';

/** Invite codes travel as links; accept a raw code or anything containing one. */
export function inviteCodeFrom(text: string): string | null {
  return text.toUpperCase().match(/[A-HJ-NP-Z2-9]{8}/)?.[0] ?? null;
}

interface GroupRow {
  id: string;
  role: string;
  name: string;
  color: string | null;
  members: number;
  needsYou: number;
}

export default function GroupsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [joinText, setJoinText] = useState('');
  const { groupInvites, friendRequests, count: inviteCount } = usePendingInvites();
  const { friends } = useFriends();

  const { data: rows, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ['groups', user?.id],
    queryFn: async (): Promise<GroupRow[]> => {
      const { data: memberships, error } = await supabase
        .from('group_members')
        .select('group_id, role, groups:group_id(id, name, color, created_at)')
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
          createdAt: m.groups?.created_at ?? '',
          members: memberCount[m.group_id] ?? 0,
          needsYou: needsCount[m.group_id] ?? 0,
        }))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    enabled: !!user,
  });

  const joinByCode = useMutation({
    mutationFn: async (code: string) => {
      const { data: found, error: findError } = await supabase.rpc('get_group_by_invite_code', {
        code,
      });
      if (findError || !found || found.length === 0) throw new Error('That link doesn’t work');

      const { error: joinError } = await supabase.from('group_members').insert({
        group_id: found[0].id,
        user_id: user?.id,
        role: 'member',
      });
      if (joinError) {
        throw new Error(
          joinError.code === '23505' ? 'You’re already in this group' : joinError.message
        );
      }
      return found[0];
    },
    onSuccess: (group) => {
      setJoinText('');
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      router.push(`/(app)/group/${group.id}`);
    },
    onError: (error: Error) => Alert.alert('Couldn’t join', error.message),
  });

  const hasGroups = (rows ?? []).length > 0;
  const joinCode = inviteCodeFrom(joinText);

  // Faces + "Padel Dilluns, Aina Roig and 1 more" for the collapsed row (18a)
  const inviteLabels = [
    ...groupInvites.map((i) => i.groupName),
    ...friendRequests.map((r) => r.personName),
  ];
  const inviteLine =
    inviteLabels.slice(0, 2).join(', ') +
    (inviteLabels.length > 2 ? ` and ${inviteLabels.length - 2} more` : '');

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
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />}
        >
          <ErrorState {...errorCopy(error)} onRetry={() => refetch()} testID="groups-error" />
        </ScrollView>
      ) : !hasGroups ? (
        // 16a: two ways in, and they're not equal — the link field is real,
        // creating is second, and the header pill stays gone.
        <View style={styles.empty}>
          <View style={styles.emptyArt}>
            <View style={[styles.emptyTile, { backgroundColor: groupColors[0] }]} />
            <View style={[styles.emptyTile, { backgroundColor: colors.border }]} />
            <View style={[styles.emptyTile, styles.emptyTileDashed]} />
          </View>
          <ThemedText variant="headerTitle" style={styles.emptyTitle}>
            A group is just{'\n'}your group of people
          </ThemedText>
          <ThemedText variant="body" color={colors.textSecondary}>
            Flatmates, the padel lot, the ones who actually turn up. Plans you make go to one
            group, not to everybody.
          </ThemedText>

          <View style={styles.joinRow}>
            <TextInput
              style={styles.joinInput}
              placeholder="Paste an invite link"
              placeholderTextColor={colors.textFaint}
              value={joinText}
              onChangeText={setJoinText}
              autoCapitalize="none"
              autoCorrect={false}
              testID="join-input"
            />
            <Pressable
              accessibilityRole="button"
              disabled={!joinCode || joinByCode.isPending}
              onPress={() => joinCode && joinByCode.mutate(joinCode)}
              style={[styles.joinButton, joinCode ? styles.joinButtonReady : null]}
              testID="join-button"
            >
              <ThemedText
                variant="bodyStrong"
                color={joinCode ? colors.textOnAccent : colors.textFaint}
                style={styles.joinButtonLabel}
              >
                Join
              </ThemedText>
            </Pressable>
          </View>
          <View style={styles.orRow}>
            <View style={styles.orLine} />
            <ThemedText variant="caption" color={colors.textFaint}>
              or
            </ThemedText>
            <View style={styles.orLine} />
          </View>
          <Button
            label="Create a group"
            variant="ink"
            onPress={() => router.push('/(app)/group/new')}
            testID="create-group"
          />
        </View>
      ) : (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />}
        >
          {inviteCount > 0 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/(app)/invites')}
              style={({ pressed }) => [styles.invitesRow, pressed && styles.pressed]}
              testID="invites-row"
            >
              <View style={styles.invitesFaces}>
                {inviteLabels.slice(0, 3).map((name, i) => (
                  <View key={`${name}-${i}`} style={[styles.invitesFace, i > 0 && styles.invitesFaceOverlap]}>
                    <Avatar name={name} size={30} />
                  </View>
                ))}
              </View>
              <View style={styles.invitesBody}>
                <ThemedText variant="bodyStrong" color={colors.background}>
                  {inviteCount} invite{inviteCount === 1 ? '' : 's'}
                </ThemedText>
                <ThemedText variant="caption" color={colors.textFaint} numberOfLines={1}>
                  {inviteLine}
                </ThemedText>
              </View>
              <ThemedText variant="body" color={colors.tabInactive}>
                ›
              </ThemedText>
            </Pressable>
          ) : null}

          <View style={styles.sectionHeader}>
            <ThemedText variant="sectionLabel">Your groups</ThemedText>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/(app)/group/new')}
              testID="new-group"
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
                <GroupTile name={g.name} color={g.color} size={42} />
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
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  findPill: {
    flexDirection: 'row',
    alignItems: 'center',
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
  invitesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    backgroundColor: colors.ink,
    borderRadius: 20,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    marginBottom: 22,
  },
  invitesFaces: {
    flexDirection: 'row',
  },
  invitesFace: {
    borderWidth: 2,
    borderColor: colors.ink,
    borderRadius: radii.pill,
  },
  invitesFaceOverlap: {
    marginLeft: -11,
  },
  invitesBody: {
    flex: 1,
    gap: spacing.xxs,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
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
  empty: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingBottom: 120,
    gap: spacing.sm,
  },
  emptyArt: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  emptyTile: {
    width: 52,
    height: 52,
    borderRadius: 17,
  },
  emptyTileDashed: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
  },
  emptyTitle: {
    paddingTop: spacing.xs,
  },
  joinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: 20,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    marginTop: spacing.lg,
  },
  joinInput: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.textPrimary,
    paddingVertical: spacing.sm,
  },
  joinButton: {
    backgroundColor: colors.surfaceSunken,
    borderRadius: radii.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: 14,
  },
  joinButtonReady: {
    backgroundColor: colors.accent,
  },
  joinButtonLabel: {
    fontSize: 14,
    lineHeight: 18,
  },
  orRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: spacing.xxs,
  },
  orLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.tabBarBorder,
  },
});
