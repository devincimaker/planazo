import {
  View,
  ScrollView,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { GroupRole } from '@planazo/shared';
import { supabase } from '../../../../lib/supabase';
import { useAuthStore } from '../../../../stores/authStore';
import { errorCopy, isNotFoundError } from '../../../../lib/queryErrors';
import { groupManageQuery } from '../../../../lib/groupManageQuery';
import { roleActionFor, roleActionLabel } from '../../../../lib/memberRole';
import { MIN_TOUCH_TARGET } from '../../../../lib/a11y';
import type { GroupMemberRow } from '../../../../components/group/MemberList';
import { ThemedText, ErrorState, Card, Avatar } from '../../../../components/ui';
import { colors, fonts, radii, spacing } from '../../../../theme/tokens';

/**
 * Who runs the group, and the one place a role changes (PLA-50).
 *
 * Promotion used to hide inside a status chip on the Manage screen, which
 * nobody was ever going to press. Here it is a labelled button on a labelled
 * screen. A non-admin who deep-links in gets a read-only list: every action
 * derives to null for them, and RLS blocks the write regardless.
 */
export default function GroupAdminsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const { data: group, isLoading, isError, error, refetch } = useQuery(groupManageQuery(id));

  const setRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: GroupRole }) => {
      const { error } = await supabase
        .from('group_members')
        .update({ role })
        .eq('group_id', id)
        .eq('user_id', userId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['group-manage', id] });
      queryClient.invalidateQueries({ queryKey: ['group', id] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
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
          testID="group-admins-error"
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

  const members = [...((group.group_members ?? []) as GroupMemberRow[])].sort((a, b) =>
    (a.joined_at ?? '').localeCompare(b.joined_at ?? '')
  );
  const me = members.find((m) => m.user_id === user?.id);
  const others = members.filter((m) => m.user_id !== user?.id);
  const viewerIsAdmin = me?.role === 'admin';
  const adminCount = members.filter((m) => m.role === 'admin').length;
  // Same order as the People card: you first, then everyone by arrival.
  const rows = me ? [me, ...others] : others;

  const renderRow = (m: GroupMemberRow, index: number) => {
    const isSelf = m.user_id === user?.id;
    const action = roleActionFor({ viewerIsAdmin, targetRole: m.role, adminCount });
    return (
      <View key={m.user_id} style={[styles.personRow, index > 0 && styles.divider]}>
        <Avatar
          name={m.profile?.display_name ?? '?'}
          size={36}
          imageUrl={m.profile?.avatar_url}
        />
        <View style={styles.personBody}>
          <View style={styles.nameLine}>
            <ThemedText variant="bodyStrong" numberOfLines={1} style={styles.name}>
              {m.profile?.display_name}
              {isSelf ? (
                <ThemedText variant="bodyStrong" color={colors.textMuted}>
                  {' '}
                  · you
                </ThemedText>
              ) : null}
            </ThemedText>
            {m.role === 'admin' ? (
              <View style={styles.roleChip} testID={`admin-${m.user_id}`}>
                <ThemedText variant="tag" color={colors.background}>
                  Admin
                </ThemedText>
              </View>
            ) : null}
          </View>
          {action === 'demote-blocked' ? (
            <ThemedText variant="caption" testID="last-admin-note">
              You’re the only admin. Make someone else admin first if you want to step down.
            </ThemedText>
          ) : null}
        </View>
        {action === 'promote' || action === 'demote' ? (
          <Pressable
            onPress={() =>
              setRole.mutate({
                userId: m.user_id,
                role: action === 'promote' ? 'admin' : 'member',
              })
            }
            disabled={setRole.isPending}
            accessibilityRole="button"
            testID={`role-action-${m.user_id}`}
            style={styles.actionButton}
          >
            <ThemedText variant="bodyStrong" color={colors.accent}>
              {roleActionLabel(action, isSelf)}
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
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
            ‹ Manage
          </ThemedText>
        </Pressable>
        <ThemedText style={styles.navTitle}>Admins</ThemedText>
        <View style={styles.navSpacer} />
      </View>

      <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
        <ThemedText variant="caption" style={styles.explainer}>
          Admins can remove people and edit the group.
        </ThemedText>
        <Card padded={false}>{rows.map(renderRow)}</Card>
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
    gap: spacing.md,
  },
  explainer: {
    paddingHorizontal: spacing.xs,
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  divider: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  personBody: {
    flex: 1,
    gap: spacing.xxs,
  },
  nameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minWidth: 0,
  },
  name: {
    flexShrink: 1,
  },
  // The same passive pill the People card wears; a status, not a control.
  roleChip: {
    paddingVertical: 5,
    paddingHorizontal: 11,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  // The word is the button; the box grows to a real target around it.
  actionButton: {
    justifyContent: 'center',
    alignItems: 'flex-end',
    minHeight: MIN_TOUCH_TARGET,
    marginVertical: -spacing.md,
  },
});
