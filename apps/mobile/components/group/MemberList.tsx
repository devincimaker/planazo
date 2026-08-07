import { View, StyleSheet, Pressable } from 'react-native';
import type { GroupRole } from '@planazo/shared';
import { MIN_TOUCH_TARGET } from '../../lib/a11y';
import { ThemedText, Card, Avatar, SwipeRow, type SwipeAction } from '../ui';
import { colors, radii, spacing } from '../../theme/tokens';

/**
 * One row of the manage screen's `group_members` select — not
 * `GroupMember` from @planazo/shared, which is the whole table row and
 * carries a full profile this query never asks for.
 */
export interface GroupMemberRow {
  user_id: string;
  role: GroupRole | null;
  notify_new_plans: boolean | null;
  joined_at: string | null;
  profile: { display_name: string | null; avatar_url: string | null } | null;
}

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

/**
 * Who runs this group, and nothing else.
 *
 * This used to be a chip on every row, "Admin" or "Member", and tapping it
 * promoted or demoted somebody. Nobody was ever going to discover that: a
 * status pill does not look like a control, and the most consequential act
 * on the screen was hiding inside the least likely thing to press. "Member"
 * is gone with it, being only the absence of admin and saying nothing.
 *
 * Promotion got its real interaction in PLA-50: the Admins screen, reached
 * through the labelled "Admins" row in the "How it runs" card. This badge
 * stays a badge.
 */
function adminBadge(m: GroupMemberRow) {
  return m.role === 'admin' ? (
    <View style={styles.roleChip} testID={`admin-${m.user_id}`}>
      <ThemedText variant="tag" color={colors.background}>
        Admin
      </ThemedText>
    </View>
  ) : null;
}

interface Props {
  /** This user's own row, pinned to the top and never swipeable. */
  me: GroupMemberRow | undefined;
  /** Everyone else, already minus anyone whose removal is pending. */
  others: GroupMemberRow[];
  /** Who this user has blocked (the shield rule). */
  blocked: Set<string>;
  /** Only one row is ever open. */
  openRowId: string | null;
  onOpenChange: (userId: string | null) => void;
  onAskRemove: (m: GroupMemberRow) => void;
  onAskBlock: (m: GroupMemberRow) => void;
  /** Null when this group's door is admins-only and this user is not one. */
  onInvite: (() => void) | null;
}

/** The People section: every member, with block and remove behind a swipe. */
export function MemberList({
  me,
  others,
  blocked,
  openRowId,
  onOpenChange,
  onAskRemove,
  onAskBlock,
  onInvite,
}: Props) {
  // Only an admin gets Remove, and whether this user is one is already in
  // their own row.
  const isAdmin = me?.role === 'admin';

  const actionsFor = (m: GroupMemberRow): SwipeAction[] => {
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
        onPress: () => onAskBlock(m),
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
        onPress: () => onAskRemove(m),
        testID: `remove-${m.user_id}`,
      });
    }
    return actions;
  };

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <ThemedText variant="sectionLabel">People</ThemedText>
        {onInvite ? (
          <Pressable
            onPress={onInvite}
            accessibilityRole="button"
            testID="invite"
            style={styles.sectionAction}
          >
            <ThemedText variant="bodyStrong" color={colors.accent}>
              Invite
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
      <Card padded={false}>
        {me ? (
          <View style={styles.personRow}>
            <Avatar
              name={me.profile?.display_name ?? '?'}
              size={36}
              imageUrl={me.profile?.avatar_url}
            />
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
        {others.map((m, index) => {
          const isBlocked = blocked.has(m.user_id);
          return (
            <View key={m.user_id} style={styles.personDivider}>
              <SwipeRow
                actions={actionsFor(m)}
                open={openRowId === m.user_id}
                onOpenChange={(next) => onOpenChange(next ? m.user_id : null)}
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
          {/* Non-admins only get Block in the swipe, so the hint must not
              promise them Remove. */}
          {isAdmin ? 'Swipe a name for remove and block' : 'Swipe a name to block'}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
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
});
