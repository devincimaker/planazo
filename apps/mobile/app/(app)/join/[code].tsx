import { useEffect } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../../lib/supabase';
import { stashPendingJoin } from '../../../lib/pendingJoin';
import {
  joinBlurb,
  joinLabel,
  joinPendingLabel,
  requestedBlurb,
  requestedEyebrow,
} from '../../../lib/groupDoor';
import { useAuthStore } from '../../../stores/authStore';
import { ThemedText, Button, GroupTile, ErrorState } from '../../../components/ui';
import { colors, spacing } from '../../../theme/tokens';

/**
 * Where an invite link lands (PLA-77).
 *
 * Serves both `https://planazo.me/join/CODE`, which is what gets shared, and
 * `planazo://join/CODE`, which is what older messages carry: route groups
 * contribute no path segment, so `(app)/join/[code]` answers to both.
 *
 * It shows the group before it joins you to it. An invite link is a thing you
 * were handed by someone else, often with no idea what is behind it, and one
 * tap that silently adds you to a group of strangers is the wrong shape for
 * that (PLA-49). So: name first, then a button you press.
 */
export default function JoinByInviteScreen() {
  // Optional, unlike the sibling screens: this route is reached from outside
  // the app, and a link that ends at /join with nothing after it still matches.
  const { code } = useLocalSearchParams<{ code?: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session } = useAuthStore();

  // Normalised, not validated. What counts as a real code is the database's
  // rule, and it already answers with `not_found`; a second copy of the rule
  // here would only ever disagree with it. The strict pattern in
  // `inviteCodeFrom` belongs to the paste field, which has the harder job of
  // finding a code inside whatever someone pasted.
  const inviteCode = (code ?? '').trim().toUpperCase();
  const signedIn = !!session;

  // No account yet is the ordinary case for an invite, not an error: this is
  // how most people meet Planazo. Hold the code and send them to sign up;
  // whichever screen ends up giving them a session brings them back here.
  // A code too mangled to hold still goes to signup rather than to a dead end:
  // they came here to get in, and signing up is the part they can still do.
  useEffect(() => {
    if (signedIn) return;
    if (inviteCode) stashPendingJoin(inviteCode);
    router.replace('/(auth)/signup');
  }, [signedIn, inviteCode, router]);

  const preview = useQuery({
    queryKey: ['invite-preview', inviteCode],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_group_by_invite_code', {
        code: inviteCode,
      });
      if (error) throw error;
      // The RPC returns a table, so an unknown code is an empty list rather
      // than an error. Nothing to preview and nothing to join.
      const group = (data as { id: string; name: string; join_mode: string }[])[0];
      return group ?? null;
    },
    enabled: signedIn && !!inviteCode,
  });

  const join = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('join_group_by_invite_code', {
        p_code: inviteCode,
      });
      if (error) throw new Error(error.message);
      return data as { status: string; group_id?: string; name?: string };
    },
    onSuccess: (result) => {
      if (result.status === 'not_found') {
        void preview.refetch();
        return;
      }
      // Nothing to do but stop: the mutation's own result is what puts the
      // screen into its asked state below.
      if (result.status === 'requested') return;
      // 'already_member' lands in the same place as 'joined'. Being told you
      // were already in a group you just asked to join is a correction nobody
      // needs; the group appearing is the answer.
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      router.replace(`/(app)/group/${result.group_id}`);
    },
  });

  const goToFeed = () => router.replace('/(app)/(tabs)');

  // Sent, and now waiting on an admin. Read off the mutation rather than kept
  // alongside it, and deliberately the same screen whether this is the first
  // ask or one that was quietly turned down before: a decline is never
  // announced (PLA-49).
  const asked = join.data?.status === 'requested';

  if (!signedIn) {
    return <Loading />;
  }

  if (!inviteCode || (preview.isSuccess && !preview.data)) {
    return (
      <Screen>
        <ErrorState
          title="That invite doesn’t work"
          body="The link may have been mistyped, or the group may be gone. Ask whoever sent it for a fresh one."
          onBack={goToFeed}
          backLabel="Go to my plans"
          testID="join-not-found"
        />
      </Screen>
    );
  }

  if (preview.isError) {
    return (
      <Screen>
        <ErrorState
          title="Couldn’t open that invite"
          body="Check your connection and try again."
          onRetry={() => void preview.refetch()}
          onBack={goToFeed}
          backLabel="Go to my plans"
          testID="join-error"
        />
      </Screen>
    );
  }

  if (!preview.data) {
    return <Loading />;
  }

  // One card, two things it can say. The layout is identical either side of
  // the ask, and only the footer changes: a card written out twice drifts the
  // first time either half is restyled.
  return (
    <Screen>
      <View style={styles.card} testID={asked ? 'join-requested' : 'join-preview'}>
        <GroupTile name={preview.data.name} size={72} />
        <View style={styles.titleBlock}>
          <ThemedText variant="sectionLabel" color={colors.textMuted}>
            {asked ? requestedEyebrow : 'You’ve been invited to'}
          </ThemedText>
          <ThemedText variant="screenTitle" style={styles.name}>
            {preview.data.name}
          </ThemedText>
        </View>
        <ThemedText variant="body" color={colors.textSecondary} style={styles.blurb}>
          {asked ? requestedBlurb() : joinBlurb(preview.data.join_mode)}
        </ThemedText>
      </View>

      {asked ? (
        <Button label="Go to my plans" onPress={goToFeed} testID="join-requested-done" />
      ) : null}

      {join.isError ? (
        <ThemedText
          variant="bodyStrong"
          color={colors.accentText}
          style={styles.failure}
          accessibilityRole="alert"
          testID="join-failed"
        >
          That didn’t go through. Check your connection and try again.
        </ThemedText>
      ) : null}

      {asked ? null : (
        <View style={styles.actions}>
          <Button
            label={
              join.isPending
                ? joinPendingLabel(preview.data.join_mode)
                : joinLabel(preview.data.join_mode, preview.data.name)
            }
            disabled={join.isPending}
            onPress={() => join.mutate()}
            testID="join-group"
          />
          <Button label="Not now" variant="secondary" onPress={goToFeed} testID="join-decline" />
        </View>
      )}
    </Screen>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.body}>{children}</View>
    </SafeAreaView>
  );
}

function Loading() {
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} testID="join-loading" />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  body: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxxl,
    gap: spacing.xl,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
  },
  card: {
    alignItems: 'center',
    gap: spacing.lg,
  },
  titleBlock: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  name: {
    textAlign: 'center',
  },
  blurb: {
    textAlign: 'center',
    maxWidth: 300,
  },
  failure: {
    textAlign: 'center',
  },
  actions: {
    gap: spacing.md,
  },
});
