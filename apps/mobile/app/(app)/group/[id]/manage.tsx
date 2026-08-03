import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
  AppState,
  Switch,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
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
import {
  ThemedText,
  Card,
  Avatar,
  ErrorState,
  ConfirmSheet,
  SwipeRow,
  showToast,
  type SwipeAction,
} from '../../../../components/ui';
import { colors, fonts, radii, spacing } from '../../../../theme/tokens';

/**
 * How long "X is out of the group" stays up, and therefore how long the
 * removal is only a promise.
 *
 * Undo has to be real or it should not be offered, and the database rules out
 * the obvious implementation: PLA-35 dropped the group_members INSERT policy,
 * so the client cannot put anybody back, and `on_group_member_delete` deletes
 * their RSVPs and date answers for every plan in the group on the way out. A
 * re-add would restore the membership and none of the rest of it.
 *
 * So the row goes at once and the DELETE waits here instead. Undo cancels a
 * statement that never ran. The window closes early — and the removal lands —
 * if the screen is left or the app is backgrounded, because a promise the user
 * has walked away from has to resolve one way or the other.
 */
const UNDO_WINDOW_MS = 5000;

/** The "no entry" glyph on the Block action: a ring with a slash. */
function BlockGlyph({ color }: { color: string }) {
  return (
    <View style={[styles.glyphRing, { borderColor: color }]}>
      <View style={[styles.glyphSlash, { backgroundColor: color }]} />
    </View>
  );
}

/** The "minus in a circle" glyph on the Remove action. */
function RemoveGlyph({ color }: { color: string }) {
  return (
    <View style={[styles.glyphRing, styles.glyphRingCentred, { borderColor: color }]}>
      <View style={[styles.glyphDash, { backgroundColor: color }]} />
    </View>
  );
}

type PendingConfirm = { kind: 'remove' | 'block'; userId: string; name: string };

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

  // Only one row is ever open, and only one removal is ever in flight.
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const [pendingRemovalId, setPendingRemovalId] = useState<string | null>(null);
  const pendingRemoval = useRef<{ userId: string; timer: ReturnType<typeof setTimeout> } | null>(
    null
  );
  // `mutate` is stable, but the unmount path runs after the last render and has
  // no business reading a closure from it.
  const removeMemberRef = useRef(removeMember.mutate);
  removeMemberRef.current = removeMember.mutate;

  /** Take the pending removal off the books and hand it back, if there is one. */
  const takePending = useCallback(() => {
    const held = pendingRemoval.current;
    if (!held) return null;
    clearTimeout(held.timer);
    pendingRemoval.current = null;
    return held;
  }, []);

  const commitRemoval = useCallback(() => {
    const held = takePending();
    if (!held) return;
    setPendingRemovalId(null);
    removeMemberRef.current(held.userId);
  }, [takePending]);

  const undoRemoval = useCallback(() => {
    const held = takePending();
    if (!held) return;
    setPendingRemovalId(null);
  }, [takePending]);

  const startRemoval = useCallback(
    (userId: string, name: string) => {
      // A second removal closes the first one's window rather than queueing
      // behind it: two undos with one toast is one undo nobody can aim.
      commitRemoval();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      setPendingRemovalId(userId);
      pendingRemoval.current = {
        userId,
        timer: setTimeout(() => commitRemoval(), UNDO_WINDOW_MS),
      };
      showToast(`${name} is out of the group`, {
        action: { label: 'Undo', onPress: undoRemoval, testID: 'undo-remove' },
        durationMs: UNDO_WINDOW_MS,
      });
    },
    [commitRemoval, undoRemoval]
  );

  // Backgrounding the app, or leaving the screen, closes the window early.
  // Without this the row is gone from the list and the person is still in the
  // group, and nothing on screen would ever say so.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') commitRemoval();
    });
    return () => sub.remove();
  }, [commitRemoval]);

  useEffect(
    () => () => {
      const held = takePending();
      if (held) removeMemberRef.current(held.userId);
    },
    [takePending]
  );

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
  // Somebody with a removal pending is already gone from the list: the undo is
  // in the toast, not in a half-there row.
  const others = members.filter(
    (m: any) => m.user_id !== user?.id && m.user_id !== pendingRemovalId
  );
  const isAdmin = me?.role === 'admin';
  const blocked = new Set(blockedIds ?? []);
  const nameOf = (m: any) => m.profile?.display_name ?? 'this person';

  const askRemove = (m: any) =>
    setConfirm({ kind: 'remove', userId: m.user_id, name: nameOf(m) });

  const askBlock = (m: any) => {
    // Unblocking is not destructive and undoes itself, so it does not ask.
    if (blocked.has(m.user_id)) {
      setBlocked.mutate({ userId: m.user_id, blocked: false });
      setOpenRowId(null);
      return;
    }
    setConfirm({ kind: 'block', userId: m.user_id, name: nameOf(m) });
  };

  const runConfirm = () => {
    if (!confirm) return;
    setConfirm(null);
    setOpenRowId(null);
    if (confirm.kind === 'remove') {
      startRemoval(confirm.userId, confirm.name);
    } else {
      setBlocked.mutate({ userId: confirm.userId, blocked: true });
    }
  };

  const confirmCopy =
    confirm?.kind === 'remove'
      ? {
          title: `Remove ${confirm.name}?`,
          body: 'They drop out of this group’s plans too.',
          action: 'Remove',
        }
      : {
          title: `Block ${confirm?.name}?`,
          body: 'Their plans stop showing up for you. They are not told, and they stay in the group unless an admin removes them.',
          action: 'Block',
        };

  const actionsFor = (m: any): SwipeAction[] => {
    const isBlocked = blocked.has(m.user_id);
    const actions: SwipeAction[] = [
      {
        key: 'block',
        // Anyone can block anyone — it is a personal choice, not an admin
        // power, and Guideline 1.2 wants it reachable without asking
        // permission from the person's friends.
        label: isBlocked ? 'Unblock' : 'Block',
        background: colors.ink,
        foreground: colors.background,
        icon: <BlockGlyph color={colors.background} />,
        onPress: () => askBlock(m),
        testID: `block-${m.user_id}`,
      },
    ];
    if (isAdmin) {
      actions.push({
        key: 'remove',
        label: 'Remove',
        background: colors.accent,
        foreground: colors.textOnAccent,
        icon: <RemoveGlyph color={colors.textOnAccent} />,
        onPress: () => askRemove(m),
        testID: `remove-${m.user_id}`,
      });
    }
    return actions;
  };

  const confirmLeave = () =>
    Alert.alert(`Leave ${group.name}?`, 'You’ll drop out of plans you said yes to.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: () => leaveGroup.mutate() },
    ]);

  /**
   * Who runs this group, and nothing else.
   *
   * This used to be a chip on every row, "Admin" or "Member", and tapping it
   * promoted or demoted somebody. Nobody was ever going to discover that: a
   * status pill does not look like a control, and the most consequential act
   * on the screen was hiding inside the least likely thing to press. "Member"
   * is gone with it, being only the absence of admin and saying nothing.
   *
   * Promotion needs a real interaction of its own, and has none until PLA-50
   * gives it one.
   */
  const adminBadge = (m: any) =>
    m.role === 'admin' ? (
      <View style={styles.roleChip} testID={`admin-${m.user_id}`}>
        <ThemedText variant="tag" color={colors.background}>
          Admin
        </ThemedText>
      </View>
    ) : null;

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
                {adminBadge(me)}
              </View>
            ) : null}
            {others.map((m: any, index: number) => {
              const isBlocked = blocked.has(m.user_id);
              return (
                <View key={m.user_id} style={styles.personDivider}>
                  <SwipeRow
                    actions={actionsFor(m)}
                    open={openRowId === m.user_id}
                    onOpenChange={(next) => setOpenRowId(next ? m.user_id : null)}
                    // One row demonstrates the gesture, once, on the first
                    // load. Every row doing it would be a light show.
                    peek={index === 0}
                    // The badge slides away with the row. Left where it was, it
                    // would end up parked on top of Remove.
                    trailing={
                      m.role === 'admin' ? (
                        <View style={styles.personTrailing}>{adminBadge(m)}</View>
                      ) : null
                    }
                    testID={`person-${m.user_id}`}
                  >
                    <View style={[styles.personRow, styles.personRowSwipe]}>
                      <View style={isBlocked ? styles.dimmed : undefined}>
                        <Avatar
                          name={m.profile?.display_name ?? '?'}
                          size={36}
                          imageUrl={m.profile?.avatar_url}
                        />
                      </View>
                      <View style={styles.personBody}>
                        <View style={styles.nameLine}>
                          <ThemedText
                            variant="bodyStrong"
                            numberOfLines={1}
                            style={[styles.name, isBlocked && styles.dimmed]}
                          >
                            {m.profile?.display_name}
                          </ThemedText>
                          {isBlocked ? (
                            <View style={styles.blockedPill} testID={`blocked-${m.user_id}`}>
                              <ThemedText variant="tag" color={colors.accentText}>
                                Blocked
                              </ThemedText>
                            </View>
                          ) : null}
                        </View>
                      </View>
                    </View>
                  </SwipeRow>
                </View>
              );
            })}
          </Card>
          {others.length > 0 ? (
            <ThemedText variant="caption" style={styles.swipeHint}>
              Swipe a name for remove and block
            </ThemedText>
          ) : null}
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
                <ThemedText variant="bodyStrong">Group profile</ThemedText>
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

      <ConfirmSheet
        visible={!!confirm}
        title={confirmCopy.title}
        body={confirmCopy.body}
        actionLabel={confirmCopy.action}
        onConfirm={runConfirm}
        onCancel={() => {
          setConfirm(null);
          setOpenRowId(null);
        }}
        testID="member-confirm"
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
    // Back to 16 all round, and so back to a 68pt row. PLA-40 had squeezed
    // this to 12 to offset the 44pt Remove and Block boxes stacked under the
    // name, which took the row to 91; the swipe took them out of the row
    // entirely, so the height they cost comes back with them.
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  // The chevron hint inside SwipeRow carries the right inset for swipeable
  // rows, so the row itself must not pay it twice.
  personRowSwipe: {
    flex: 1,
    paddingRight: 0,
  },
  personDivider: {
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
  // A blocked person stays legible — you have to be able to read who it is to
  // decide to unblock them — but stops looking like a full member.
  dimmed: {
    opacity: 0.55,
  },
  blockedPill: {
    paddingVertical: 3,
    paddingHorizontal: 9,
    borderRadius: radii.pill,
    backgroundColor: colors.accentSoft,
  },
  swipeHint: {
    paddingHorizontal: spacing.xs,
  },
  // The gap the chip used to get from personRow, now that it sits outside it.
  personTrailing: {
    marginLeft: spacing.md,
  },
  rowPressed: {
    backgroundColor: colors.surfaceSunken,
  },
  // A status pill that looks like one, and no longer pretends otherwise. It
  // needed no touch target once it stopped being a button (PLA-40's 44pt
  // wrapper went with the tap).
  roleChip: {
    paddingVertical: 5,
    paddingHorizontal: 11,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    backgroundColor: colors.ink,
    borderColor: colors.ink,
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
  /**
   * The glyphs on the swipe actions, drawn rather than imported: two rings of
   * the same size, one slashed and one with a dash through the middle. An icon
   * font for two 17pt shapes would be a dependency for nothing.
   */
  glyphRing: {
    width: 17,
    height: 17,
    borderRadius: radii.pill,
    borderWidth: 1.5,
  },
  glyphRingCentred: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyphSlash: {
    position: 'absolute',
    left: -1,
    top: 6.2,
    width: 16,
    height: 1.5,
    transform: [{ rotate: '-45deg' }],
  },
  glyphDash: {
    width: 8,
    height: 1.5,
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
