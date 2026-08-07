import { View, StyleSheet, Pressable } from 'react-native';
import { MIN_TOUCH_TARGET } from '../../lib/a11y';
import { adminSub, adminsLabel, adminsNote } from '../../lib/groupAdmins';
import { ThemedText, Card, Avatar } from '../ui';
import { colors, radii, spacing } from '../../theme/tokens';
import type { GroupMemberRow } from './MemberList';

/** The ring-and-dash on a demote control, drawn like MemberList's glyphs. */
function MinusRing({ color }: { color: string }) {
  return (
    <View style={[styles.glyphRing, { borderColor: color }]}>
      <View style={[styles.glyphDash, { backgroundColor: color }]} />
    </View>
  );
}

interface Props {
  /** Current admins, already ordered (you first, then by arrival). */
  admins: GroupMemberRow[];
  myId: string | undefined;
  createdBy: string | null;
  /** Non-admin viewers get the list with no controls and no note. */
  viewerIsAdmin: boolean;
  disabled: boolean;
  onDemote: (m: GroupMemberRow) => void;
}

/**
 * The "Admins · N" card: who holds the role, and each one's way out of it.
 * With one admin left there is no control at all (never a disabled one);
 * the note under the card says why, and what to do instead.
 */
export function AdminsCard({ admins, myId, createdBy, viewerIsAdmin, disabled, onDemote }: Props) {
  const lastAdmin = admins.length <= 1;
  const nameOf = (m: GroupMemberRow) => m.profile?.display_name ?? 'this person';

  return (
    <View style={styles.section}>
      <ThemedText variant="sectionLabel">{adminsLabel(admins.length)}</ThemedText>
      <Card padded={false}>
        {admins.map((m, index) => (
          <View key={m.user_id} style={[styles.personRow, index > 0 && styles.divider]}>
            <Avatar name={nameOf(m)} size={36} imageUrl={m.profile?.avatar_url} />
            <View style={styles.personBody}>
              <ThemedText variant="bodyStrong" numberOfLines={1}>
                {m.profile?.display_name}
                {m.user_id === myId ? (
                  <ThemedText variant="bodyStrong" color={colors.textMuted}>
                    {' '}
                    · you
                  </ThemedText>
                ) : null}
              </ThemedText>
              <ThemedText variant="caption">{adminSub(m.user_id, createdBy)}</ThemedText>
            </View>
            {viewerIsAdmin && !lastAdmin ? (
              <Pressable
                onPress={() => onDemote(m)}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel={
                  m.user_id === myId ? 'Step down as admin' : `Remove ${nameOf(m)} as admin`
                }
                testID={`demote-${m.user_id}`}
                style={({ pressed }) => [styles.demoteButton, pressed && styles.rowPressed]}
              >
                <MinusRing color={colors.accentText} />
              </Pressable>
            ) : null}
          </View>
        ))}
      </Card>
      {viewerIsAdmin ? (
        <ThemedText variant="caption" style={styles.cardNote} testID="admins-note">
          {adminsNote(lastAdmin)}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 10,
  },
  // Tighter than the People card's 16 vertical: the 44pt control at the row's
  // end carries the height, so 12 keeps the row at 68 instead of 76.
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.md,
  },
  divider: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  personBody: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xxs,
  },
  demoteButton: {
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
    borderRadius: radii.row,
  },
  rowPressed: {
    backgroundColor: colors.surfaceSunken,
  },
  cardNote: {
    paddingHorizontal: spacing.xs,
  },
  glyphRing: {
    width: 20,
    height: 20,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  glyphDash: {
    width: 9,
    height: 1.5,
  },
});
