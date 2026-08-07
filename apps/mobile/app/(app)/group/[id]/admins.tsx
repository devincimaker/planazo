import { useState } from 'react';
import { View, ScrollView, StyleSheet, Pressable, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { GroupRole } from '@planazo/shared';
import { supabase } from '../../../../lib/supabase';
import { useAuthStore } from '../../../../stores/authStore';
import { errorCopy, isNotFoundError } from '../../../../lib/queryErrors';
import { groupManageQuery } from '../../../../lib/groupManageQuery';
import { splitByRole, demoteConfirmCopy } from '../../../../lib/groupAdmins';
import { MIN_TOUCH_TARGET } from '../../../../lib/a11y';
import type { GroupMemberRow } from '../../../../components/group/MemberList';
import { AdminsCard } from '../../../../components/group/AdminsCard';
import { PromoteCard } from '../../../../components/group/PromoteCard';
import { ThemedText, ErrorState, ConfirmSheet } from '../../../../components/ui';
import { colors, fonts, spacing } from '../../../../theme/tokens';

/**
 * Who runs the group, and the one place a role changes ("Group Admins"
 * design doc, PLA-50).
 *
 * Two cards: the admins, each with a way out of the role behind a confirm
 * sheet, and everyone who could hold it, behind a search and a single tap.
 * Promotion is instant because it is reversible right here; demotion asks
 * first because it takes something away from a person. A non-admin who
 * deep-links in gets the admins card read-only: no demote controls, no
 * promote section, and RLS refuses the write regardless.
 */
export default function GroupAdminsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [query, setQuery] = useState('');
  const [demoting, setDemoting] = useState<{ userId: string; name: string; isSelf: boolean } | null>(
    null
  );

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

  const members = (group.group_members ?? []) as GroupMemberRow[];
  const { admins, candidates } = splitByRole(members, user?.id);
  const viewerIsAdmin = admins.some((m) => m.user_id === user?.id);

  const askDemote = (m: GroupMemberRow) =>
    setDemoting({
      userId: m.user_id,
      name: m.profile?.display_name ?? 'this person',
      isSelf: m.user_id === user?.id,
    });

  const runDemote = () => {
    if (!demoting) return;
    setDemoting(null);
    setRole.mutate({ userId: demoting.userId, role: 'member' });
  };

  const confirmCopy = demoteConfirmCopy(demoting?.name ?? '', !!demoting?.isSelf);

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

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <ThemedText variant="sub">
          Admins edit the group, remove people, and make other admins.
        </ThemedText>

        <AdminsCard
          admins={admins}
          myId={user?.id}
          createdBy={group.created_by ?? null}
          viewerIsAdmin={viewerIsAdmin}
          disabled={setRole.isPending}
          onDemote={askDemote}
        />

        {viewerIsAdmin ? (
          <PromoteCard
            candidates={candidates}
            query={query}
            onQueryChange={setQuery}
            disabled={setRole.isPending}
            onPromote={(m) => setRole.mutate({ userId: m.user_id, role: 'admin' })}
          />
        ) : null}
      </ScrollView>

      <ConfirmSheet
        visible={!!demoting}
        title={confirmCopy.title}
        body={confirmCopy.body}
        actionLabel={confirmCopy.actionLabel}
        onConfirm={runDemote}
        onCancel={() => setDemoting(null)}
        testID="confirm-demote"
      />
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
    gap: spacing.xxl,
  },
});
