import { View, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeOutUp, LinearTransition } from 'react-native-reanimated';
import { supabase } from '../../lib/supabase';
import {
  usePendingInvites,
  type PendingFriendRequest,
  type PendingGroupInvite,
} from '../../lib/usePendingInvites';
import { MIN_TOUCH_TARGET } from '../../lib/a11y';
import { ThemedText, Badge, Button, Avatar, GroupTile } from '../../components/ui';
import { colors, fonts, spacing } from '../../theme/tokens';

export function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return mins <= 1 ? 'just now' : `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return `${Math.floor(days / 7)}w ago`;
}

/** "Marta invited you · Jordi, Aina and 3 more" */
function memberLine(invite: PendingGroupInvite): string {
  const others = invite.memberNames.filter((n) => n !== invite.inviterName);
  const shown = others.slice(0, 2);
  const extra = others.length - shown.length;
  const tail =
    shown.length === 0 ? '' : ` · ${shown.join(', ')}${extra > 0 ? ` and ${extra} more` : ''}`;
  return `invited you${tail}`;
}

export default function InvitesSheet() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { groupInvites, friendRequests, count } = usePendingInvites();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['invites'] });
    queryClient.invalidateQueries({ queryKey: ['groups'] });
    queryClient.invalidateQueries({ queryKey: ['friends'] });
    queryClient.invalidateQueries({ queryKey: ['home-plans'] });
  };

  const respondInvite = useMutation({
    mutationFn: async ({ id, accept }: { id: string; accept: boolean }) => {
      const { error } = await supabase.rpc('respond_group_invite', {
        p_invite_id: id,
        p_accept: accept,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (error: Error) => Alert.alert('Error', error.message),
  });

  const respondRequest = useMutation({
    mutationFn: async ({ id, accept }: { id: string; accept: boolean }) => {
      const { error } = await supabase.rpc('respond_friend_request', {
        p_friendship_id: id,
        p_accept: accept,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (error: Error) => Alert.alert('Error', error.message),
  });

  const renderGroupInvite = (invite: PendingGroupInvite) => (
    <Animated.View
      key={invite.id}
      exiting={FadeOutUp}
      layout={LinearTransition}
      style={styles.card}
      testID={`invite-${invite.id}`}
    >
      <View style={styles.cardTop}>
        <Badge
          label="Group invite"
          tone="custom"
          bg={invite.groupColor ?? colors.surfaceSunken}
          fg={colors.ink}
          uppercase
        />
        <ThemedText variant="caption">{timeAgo(invite.createdAt)}</ThemedText>
      </View>
      <View style={styles.cardBody}>
        <GroupTile name={invite.groupName} color={invite.groupColor} size={44} />
        <View style={styles.cardText}>
          <ThemedText variant="cardTitle" numberOfLines={1}>
            {invite.groupName}
          </ThemedText>
          <ThemedText variant="caption" numberOfLines={1}>
            <ThemedText variant="caption" color={colors.textPrimary} style={styles.strong}>
              {invite.inviterName}
            </ThemedText>{' '}
            {memberLine(invite)}
          </ThemedText>
        </View>
      </View>
      <View style={styles.cardActions}>
        <Button
          label="Ignore"
          variant="secondary"
          size="md"
          style={styles.ignore}
          onPress={() => respondInvite.mutate({ id: invite.id, accept: false })}
          testID={`invite-ignore-${invite.id}`}
        />
        <Button
          label="Join group"
          size="md"
          style={styles.accept}
          onPress={() => respondInvite.mutate({ id: invite.id, accept: true })}
          testID={`invite-join-${invite.id}`}
        />
      </View>
    </Animated.View>
  );

  const renderFriendRequest = (req: PendingFriendRequest) => (
    <Animated.View
      key={req.id}
      exiting={FadeOutUp}
      layout={LinearTransition}
      style={styles.card}
      testID={`request-${req.id}`}
    >
      <View style={styles.cardTop}>
        <Badge label="Friend request" tone="muted" uppercase />
        <ThemedText variant="caption">{timeAgo(req.createdAt)}</ThemedText>
      </View>
      <View style={styles.cardBody}>
        <Avatar name={req.personName} size={44} imageUrl={req.personAvatarUrl} />
        <View style={styles.cardText}>
          <ThemedText variant="cardTitle" numberOfLines={1}>
            {req.personName}
          </ThemedText>
          <ThemedText variant="caption" numberOfLines={1}>
            {req.personHandle ? `@${req.personHandle}` : ''}
            {req.personHandle && req.sharedGroup ? ' · ' : ''}
            {req.sharedGroup ? `both in ${req.sharedGroup}` : ''}
          </ThemedText>
        </View>
      </View>
      <View style={styles.cardActions}>
        <Button
          label="Ignore"
          variant="secondary"
          size="md"
          style={styles.ignore}
          onPress={() => respondRequest.mutate({ id: req.id, accept: false })}
          testID={`request-ignore-${req.id}`}
        />
        <Button
          label="Accept"
          variant="ink"
          size="md"
          style={styles.accept}
          onPress={() => respondRequest.mutate({ id: req.id, accept: true })}
          testID={`request-accept-${req.id}`}
        />
      </View>
    </Animated.View>
  );

  // One list, newest first, both kinds mixed (18b shows them interleaved)
  const cards = [
    ...groupInvites.map((i) => ({ at: i.createdAt, node: renderGroupInvite(i) })),
    ...friendRequests.map((r) => ({ at: r.createdAt, node: renderFriendRequest(r) })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <SafeAreaView style={styles.screen} edges={[]}>
      <View style={styles.grabber} />
      <View style={styles.header}>
        <ThemedText style={styles.headerTitle}>Invites</ThemedText>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          testID="done"
          style={styles.headerAction}
        >
          <ThemedText variant="bodyStrong" color={colors.textSecondary}>
            Done
          </ThemedText>
        </Pressable>
      </View>

      <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
        {count === 0 ? (
          <ThemedText variant="body" color={colors.textSecondary} style={styles.allClear}>
            All clear. Nothing waiting on you.
          </ThemedText>
        ) : (
          cards.map((c) => c.node)
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
  grabber: {
    width: 40,
    height: 5,
    borderRadius: 999,
    backgroundColor: colors.borderStrong,
    alignSelf: 'center',
    marginTop: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: 14,
  },
  // "Done" was the 20pt-tall word itself. Here the row is sized by its 27pt
  // title rather than by the button, so instead of moving the row's padding
  // the box takes its 44 and hands the surplus straight back — the sheet
  // header keeps its shape exactly (PLA-40).
  headerAction: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
    marginVertical: -(MIN_TOUCH_TARGET - 27) / 2,
  },
  headerTitle: {
    fontFamily: fonts.displayHeavy,
    fontSize: 23,
    lineHeight: 27,
    letterSpacing: -0.46,
    color: colors.textPrimary,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  allClear: {
    textAlign: 'center',
    paddingVertical: spacing.xxxl,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: 22,
    padding: 15,
    gap: 13,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  cardBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },
  cardText: {
    flex: 1,
    gap: 3,
  },
  strong: {
    fontFamily: fonts.bodyBold,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 9,
  },
  ignore: {
    flexBasis: 104,
    flexGrow: 0,
  },
  accept: {
    flex: 1,
  },
});
