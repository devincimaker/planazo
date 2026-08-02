import {
  View,
  ScrollView,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
  Switch,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../../../lib/supabase';
import { useAuthStore } from '../../../../stores/authStore';
import { errorCopy, isNotFoundError } from '../../../../lib/queryErrors';
import { MIN_TOUCH_TARGET } from '../../../../lib/a11y';
import {
  BLOCKED_QUERY_KEY,
  blockUser,
  fetchBlockedIds,
  unblockUser,
} from '../../../../lib/moderation';
import { ThemedText, Card, Avatar, ErrorState } from '../../../../components/ui';
import { colors, fonts, radii, spacing } from '../../../../theme/tokens';

export default function ManageGroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const { data: group, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['group-manage', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('groups')
        .select(
          `id, name, color, invite_code, anyone_can_post,
          group_members(user_id, role, notify_new_plans, joined_at,
            profile:profiles(display_name, avatar_url))`
        )
        .eq('id', id)
        .single();
      if (error) throw error;
      return data as any;
    },
    enabled: !!id,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['group-manage', id] });
    queryClient.invalidateQueries({ queryKey: ['group', id] });
    queryClient.invalidateQueries({ queryKey: ['groups'] });
  };

  // Whose plans this user has chosen not to see. Only ever their own list —
  // RLS on blocked_users makes any other answer impossible.
  const { data: blockedIds } = useQuery({
    queryKey: BLOCKED_QUERY_KEY,
    queryFn: fetchBlockedIds,
    enabled: !!user,
  });

  const setBlocked = useMutation({
    mutationFn: async ({ userId, blocked }: { userId: string; blocked: boolean }) => {
      if (!user) throw new Error('Not signed in');
      if (blocked) {
        await blockUser(user.id, userId);
      } else {
        await unblockUser(user.id, userId);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: BLOCKED_QUERY_KEY });
      // Their plans appear or disappear from every list that shows them.
      queryClient.invalidateQueries({ queryKey: ['home-plans'] });
      invalidate();
    },
    onError: (error: Error) => Alert.alert('Error', error.message),
  });

  const setRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: 'admin' | 'member' }) => {
      const { error } = await supabase
        .from('group_members')
        .update({ role })
        .eq('group_id', id)
        .eq('user_id', userId);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (error: Error) => Alert.alert('Error', error.message),
  });

  const removeMember = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase
        .from('group_members')
        .delete()
        .eq('group_id', id)
        .eq('user_id', userId);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (error: Error) => Alert.alert('Error', error.message),
  });

  const setAnyoneCanPost = useMutation({
    mutationFn: async (on: boolean) => {
      const { error } = await supabase.from('groups').update({ anyone_can_post: on }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (error: Error) => Alert.alert('Error', error.message),
  });

  const setNotify = useMutation({
    mutationFn: async (on: boolean) => {
      const { error } = await supabase.rpc('set_group_notify', {
        p_group_id: id,
        p_notify: on,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (error: Error) => Alert.alert('Error', error.message),
  });

  const leaveGroup = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('leave_group', { p_group_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      queryClient.invalidateQueries({ queryKey: ['home-plans'] });
      router.navigate('/(app)/(tabs)/groups');
    },
    onError: (error: Error) => Alert.alert('Error', error.message),
  });

  if (!isLoading && (isError || !group)) {
    const notFound = !id || isNotFoundError(error);
    const copy = notFound
      ? {
          title: "This group isn't here",
          body: "It was deleted, or you've been removed from it.",
        }
      : errorCopy(error);

    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <ErrorState
          title={copy.title}
          body={copy.body}
          onRetry={notFound ? undefined : () => refetch()}
          onBack={() =>
            router.canGoBack() ? router.back() : router.replace('/(app)/(tabs)/groups')
          }
          testID="group-manage-error"
        />
      </SafeAreaView>
    );
  }

  if (isLoading || !group) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  const members = [...(group.group_members ?? [])].sort((a: any, b: any) =>
    (a.joined_at ?? '').localeCompare(b.joined_at ?? '')
  );
  const me = members.find((m: any) => m.user_id === user?.id);
  const others = members.filter((m: any) => m.user_id !== user?.id);
  const isAdmin = me?.role === 'admin';
  const blocked = new Set(blockedIds ?? []);

  const confirmRemove = (m: any) =>
    Alert.alert(
      `Remove ${m.profile?.display_name}?`,
      'They drop out of this group’s plans too.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => removeMember.mutate(m.user_id),
        },
      ]
    );

  const confirmBlock = (m: any) => {
    const name = m.profile?.display_name ?? 'this person';
    if (blocked.has(m.user_id)) {
      setBlocked.mutate({ userId: m.user_id, blocked: false });
      return;
    }
    Alert.alert(
      `Block ${name}?`,
      'Their plans stop showing up for you. They are not told, and they stay in the group unless an admin removes them.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: () => setBlocked.mutate({ userId: m.user_id, blocked: true }),
        },
      ]
    );
  };

  const confirmLeave = () =>
    Alert.alert(`Leave ${group.name}?`, 'You’ll drop out of plans you said yes to.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: () => leaveGroup.mutate() },
    ]);

  const roleChip = (m: any) => {
    const admin = m.role === 'admin';
    const chip = (
      <View style={[styles.roleChip, admin ? styles.roleChipAdmin : styles.roleChipMember]}>
        <ThemedText variant="tag" color={admin ? colors.background : colors.textSecondary}>
          {admin ? 'Admin' : 'Member'}
        </ThemedText>
      </View>
    );
    if (!isAdmin || m.user_id === user?.id) return chip;
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => setRole.mutate({ userId: m.user_id, role: admin ? 'member' : 'admin' })}
        testID={`role-${m.user_id}`}
        style={styles.roleAction}
      >
        {chip}
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.navRow}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          testID="back"
          style={styles.navAction}
        >
          <ThemedText variant="bodyStrong" color={colors.accent} numberOfLines={1}>
            ‹ {group.name}
          </ThemedText>
        </Pressable>
        <ThemedText style={styles.navTitle}>Manage</ThemedText>
        <View style={styles.navSpacer} />
      </View>

      <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <ThemedText variant="sectionLabel">People</ThemedText>
            <Pressable
              onPress={() => router.push(`/(app)/group/${id}/invite`)}
              accessibilityRole="button"
              testID="invite"
              style={styles.sectionAction}
            >
              <ThemedText variant="bodyStrong" color={colors.accent}>
                Invite
              </ThemedText>
            </Pressable>
          </View>
          <Card padded={false}>
            {me ? (
              <View style={styles.personRow}>
                <Avatar name={me.profile?.display_name ?? '?'} size={36} imageUrl={me.profile?.avatar_url} />
                <View style={styles.personBody}>
                  <ThemedText variant="bodyStrong" numberOfLines={1}>
                    {me.profile?.display_name}{' '}
                    <ThemedText variant="bodyStrong" color={colors.textMuted}>
                      · you
                    </ThemedText>
                  </ThemedText>
                </View>
                {roleChip(me)}
              </View>
            ) : null}
            {others.map((m: any) => (
              <View key={m.user_id} style={[styles.personRow, styles.personDivider]}>
                <Avatar
                  name={m.profile?.display_name ?? '?'}
                  size={36}
                  imageUrl={m.profile?.avatar_url}
                />
                <View style={styles.personBody}>
                  <ThemedText variant="bodyStrong" numberOfLines={1}>
                    {m.profile?.display_name}
                  </ThemedText>
                  <View style={styles.personActions}>
                    {isAdmin ? (
                      <Pressable
                        onPress={() => confirmRemove(m)}
                        accessibilityRole="button"
                        style={styles.personAction}
                        testID={`remove-${m.user_id}`}
                      >
                        <ThemedText variant="caption">Remove</ThemedText>
                      </Pressable>
                    ) : null}
                    {/* Anyone can block anyone — it is a personal choice, not
                        an admin power, and Guideline 1.2 wants it reachable
                        without asking permission from the person's friends. */}
                    <Pressable
                      onPress={() => confirmBlock(m)}
                      accessibilityRole="button"
                      style={styles.personAction}
                      disabled={setBlocked.isPending}
                      testID={`block-${m.user_id}`}
                    >
                      <ThemedText
                        variant="caption"
                        color={blocked.has(m.user_id) ? colors.accentText : colors.textMuted}
                      >
                        {blocked.has(m.user_id) ? 'Blocked · Undo' : 'Block'}
                      </ThemedText>
                    </Pressable>
                  </View>
                </View>
                {roleChip(m)}
              </View>
            ))}
          </Card>
        </View>

        <View style={styles.section}>
          <ThemedText variant="sectionLabel">How it runs</ThemedText>
          <Card padded={false}>
            <View style={styles.prefRow}>
              <View style={styles.prefBody}>
                <ThemedText variant="bodyStrong">Anyone can post plans</ThemedText>
                <ThemedText variant="caption">Off means only admins can</ThemedText>
              </View>
              <Switch
                value={!!group.anyone_can_post}
                disabled={!isAdmin || setAnyoneCanPost.isPending}
                onValueChange={(on) => setAnyoneCanPost.mutate(on)}
                trackColor={{ false: colors.borderStrong, true: colors.accent }}
                ios_backgroundColor={colors.borderStrong}
                testID="pref-anyone-can-post"
              />
            </View>
            <View style={[styles.prefRow, styles.personDivider]}>
              <View style={styles.prefBody}>
                <ThemedText variant="bodyStrong">Notify me on new plans</ThemedText>
                <ThemedText variant="caption">Push as soon as something lands</ThemedText>
              </View>
              <Switch
                value={!!me?.notify_new_plans}
                disabled={setNotify.isPending}
                onValueChange={(on) => setNotify.mutate(on)}
                trackColor={{ false: colors.borderStrong, true: colors.accent }}
                ios_backgroundColor={colors.borderStrong}
                testID="pref-notify"
              />
            </View>
            {isAdmin ? (
              <Pressable
                style={({ pressed }) => [
                  styles.prefRow,
                  styles.personDivider,
                  pressed && styles.rowPressed,
                ]}
                onPress={() => router.push(`/(app)/group/${id}/edit`)}
                accessibilityRole="button"
                testID="edit-group"
              >
                <ThemedText variant="bodyStrong">Rename or recolour</ThemedText>
                <ThemedText variant="body" color={colors.textFaint}>
                  ›
                </ThemedText>
              </Pressable>
            ) : null}
          </Card>
        </View>

        <View style={styles.leaveBlock}>
          <Pressable
            style={({ pressed }) => [styles.reportRow, pressed && styles.rowPressed]}
            onPress={() =>
              router.push({
                pathname: '/(app)/report',
                params: { type: 'group', id: String(id), subject: group.name },
              })
            }
            accessibilityRole="button"
            testID="report-group"
          >
            <ThemedText variant="caption" color={colors.textSecondary}>
              Report this group
            </ThemedText>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.leaveCard, pressed && styles.rowPressed]}
            onPress={confirmLeave}
            accessibilityRole="button"
            testID="leave-group"
          >
            <ThemedText variant="bodyStrong" color={colors.accentPressed}>
              Leave {group.name}
            </ThemedText>
          </Pressable>
          <ThemedText variant="caption" style={styles.leaveNote}>
            You’ll drop out of plans you said yes to. Someone else keeps admin.
          </ThemedText>
        </View>
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
  },
  // Row padding moved onto the button (PLA-40); the row lands at 44 where it
  // was 45. The label is "‹ <group name>", always wider than 44.
  navAction: {
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET,
  },
  navTitle: {
    fontFamily: fonts.display,
    fontSize: 17,
    lineHeight: 21,
    color: colors.textPrimary,
  },
  navSpacer: {
    width: 20,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: 6,
    paddingBottom: 40,
    gap: spacing.xxl,
  },
  section: {
    gap: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    // Was `baseline`: a 44pt box aligns by the baseline of the text inside it,
    // which would have dragged the whole row around. Centring the two makes
    // the box's height its own business (PLA-40).
    alignItems: 'center',
  },
  // "Invite" is a ~40×20 word; the box grows leftwards so `space-between`
  // keeps it flush right, and the negative margin keeps the row at 20.
  sectionAction: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    marginVertical: -(MIN_TOUCH_TARGET - 20) / 2,
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    // 12 rather than 14 to claw back a little of what this row grew by: the
    // actions sit *under* the name inside personBody, not beside the avatar,
    // so taking them from a 17pt word to a real 44pt box takes the row from
    // 68 to 91. That is the price of the two of them not overlapping — see
    // personAction below.
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  personDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  personBody: {
    flex: 1,
    gap: spacing.xxs,
  },
  rowPressed: {
    backgroundColor: colors.surfaceSunken,
  },
  // The chip itself stays 28 — it is a status pill and looks like one. The
  // Pressable around it is what has to be 44, and the person row is already
  // taller than that, so nothing moves (PLA-40).
  roleAction: {
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET,
  },
  roleChip: {
    paddingVertical: 5,
    paddingHorizontal: 11,
    borderRadius: radii.pill,
    borderWidth: 1.5,
  },
  roleChipAdmin: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  roleChipMember: {
    backgroundColor: colors.surfaceSunken,
    borderColor: colors.borderStrong,
  },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    padding: spacing.lg,
  },
  prefBody: {
    flex: 1,
    gap: 3,
  },
  personActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  /**
   * "Remove" and "Block" were 17pt words carrying LINK_HIT_SLOP. That reached
   * 44 invisibly, and 12pt of slop a side across a 12pt gap meant the two
   * regions *overlapped* the whole way — so the strip just right of "Remove"
   * actually blocked the person, the later sibling winning a tap nobody could
   * see was contested. Between two irreversible and quite different acts, that
   * is the worst place in the app for an invisible boundary.
   *
   * Real boxes cannot overlap, so they sit 12pt apart instead. The cost is
   * honest and visible: the member row goes 68 → 91 (PLA-40).
   */
  personAction: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
  },
  // 33 (8 + 17 + 8), with the "Leave group" card 8pt below it — hence the
  // surplus going back as margin rather than the box simply growing into its
  // neighbour's target (PLA-40).
  reportRow: {
    alignSelf: 'center',
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET,
    marginVertical: -(MIN_TOUCH_TARGET - 33) / 2,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  leaveBlock: {
    gap: spacing.sm,
    paddingBottom: 10,
  },
  leaveCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    padding: spacing.lg,
    alignItems: 'center',
  },
  leaveNote: {
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
});
