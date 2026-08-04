import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { BLOCKED_QUERY_KEY, fetchBlockedIds, unblockUser } from '../../../lib/moderation';
import { useAuthStore } from '../../../stores/authStore';
import { MIN_TOUCH_TARGET } from '../../../lib/a11y';
import { Avatar, Card, ThemedText } from '../../../components/ui';
import { colors, fonts, radii, spacing } from '../../../theme/tokens';

interface BlockedPerson {
  id: string;
  name: string;
  handle: string | null;
  avatarUrl: string | null;
}

/**
 * PLA-44: the block list. Until now a block could only be undone from the
 * manage screen of a group both people are still in — someone who blocked a
 * person and then left the group had no way back. This is the way back, and
 * the one place the app states what a block actually does.
 */
export default function BlockedPeopleScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const { data: blocked, isPending } = useQuery({
    queryKey: [...BLOCKED_QUERY_KEY, 'profiles'],
    queryFn: async (): Promise<BlockedPerson[]> => {
      // fetchBlockedIds owns the block list (newest first); the second query
      // only hydrates profiles, which PostgREST cannot embed through
      // blocked_users' auth.users FK.
      const ids = await fetchBlockedIds();
      if (ids.length === 0) return [];

      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, display_name, handle, avatar_url')
        .in('id', ids);
      if (profilesError) throw profilesError;

      const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
      return ids.flatMap((id) => {
        const p = byId.get(id);
        return p
          ? [{ id: p.id, name: p.display_name, handle: p.handle, avatarUrl: p.avatar_url }]
          : [];
      });
    },
    enabled: !!user,
  });

  // No confirm: unblocking is not destructive and undoes itself. What it does
  // not undo is what the block dissolved, which the footnote says out loud.
  const unblock = useMutation({
    mutationFn: async (blockedId: string) => unblockUser(user!.id, blockedId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: BLOCKED_QUERY_KEY });
    },
    onError: (error: Error) => Alert.alert('Error', error.message),
  });

  const people = blocked ?? [];

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.navRow}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          testID="back"
          style={styles.backAction}
        >
          <ThemedText style={styles.backChevron}>‹</ThemedText>
        </Pressable>
        <ThemedText style={styles.navTitle}>Blocked people</ThemedText>
      </View>

      <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
        {isPending ? null : people.length === 0 ? (
          <ThemedText variant="sub" testID="blocked-empty">
            You haven't blocked anyone.
          </ThemedText>
        ) : (
          <Card padded={false}>
            {people.map((p, i) => (
              <View key={p.id} style={[styles.personRow, i > 0 && styles.divider]}>
                <Avatar name={p.name} size={42} imageUrl={p.avatarUrl} />
                <View style={styles.personBody}>
                  <ThemedText variant="bodyStrong" style={styles.personName} numberOfLines={1}>
                    {p.name}
                  </ThemedText>
                  {p.handle ? (
                    <ThemedText variant="caption" numberOfLines={1}>
                      @{p.handle}
                    </ThemedText>
                  ) : null}
                </View>
                <Pressable
                  accessibilityRole="button"
                  disabled={unblock.isPending}
                  onPress={() => unblock.mutate(p.id)}
                  style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
                  testID={`unblock-${p.id}`}
                >
                  <ThemedText variant="bodyStrong" color={colors.textPrimary} style={styles.pillLabel}>
                    Unblock
                  </ThemedText>
                </Pressable>
              </View>
            ))}
          </Card>
        )}

        <ThemedText variant="caption" color={colors.textFaint} style={styles.footnote}>
          Someone you block stops seeing your plans and can't find or contact you. They are
          not told, and you still see them and their plans as usual. Unblocking lets them
          see your plans again, but it doesn't bring back the friendship or their spot in
          your plans.
        </ThemedText>
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
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: spacing.xl,
    paddingTop: 14,
    paddingBottom: 10,
  },
  // Same 44×44 chevron box as find-people, surplus handed back (PLA-40).
  backAction: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    marginVertical: -(MIN_TOUCH_TARGET - 26) / 2,
    marginHorizontal: -(MIN_TOUCH_TARGET - 10) / 2,
  },
  backChevron: {
    fontSize: 22,
    lineHeight: 26,
    color: colors.textPrimary,
  },
  navTitle: {
    fontFamily: fonts.display,
    fontSize: 20,
    lineHeight: 24,
    color: colors.textPrimary,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: 40,
    gap: spacing.xl,
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 13,
    paddingHorizontal: 15,
  },
  divider: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  personBody: {
    flex: 1,
    gap: spacing.xxs,
  },
  personName: {
    fontSize: 16,
    lineHeight: 20,
  },
  pill: {
    borderRadius: radii.pill,
    paddingVertical: 9,
    paddingHorizontal: 16,
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: colors.surfaceSunken,
  },
  pillLabel: {
    fontSize: 14,
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.8,
  },
  footnote: {
    lineHeight: 18,
  },
});
