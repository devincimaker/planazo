import { View, StyleSheet, Switch } from 'react-native';
import { ThemedText, Card } from '../ui';
import { colors, spacing } from '../../theme/tokens';
import { joinModeOf, whoCanInviteOf, type JoinMode, type WhoCanInvite } from '../../lib/groupDoor';

interface Props {
  whoCanInvite: string | null | undefined;
  joinMode: string | null | undefined;
  onChange: (door: { whoCanInvite?: WhoCanInvite; joinMode?: JoinMode }) => void;
  pending: boolean;
  isAdmin: boolean;
}

/**
 * "Who gets in": the two dials from PLA-49.
 *
 * Both are shown to everybody and only an admin can move them, matching the
 * card above. A member who cannot find the Invite button gets to see why, and
 * that is worth more than hiding the section from them.
 */
export function DoorSettings({ whoCanInvite, joinMode, onChange, pending, isAdmin }: Props) {
  const adminsOnly = whoCanInviteOf(whoCanInvite) === 'admins';
  const needsApproval = joinModeOf(joinMode) === 'approval';

  return (
    <View style={styles.section}>
      <ThemedText variant="sectionLabel">Who gets in</ThemedText>
      <Card padded={false}>
        <View style={styles.prefRow}>
          <View style={styles.prefBody}>
            <ThemedText variant="bodyStrong">Only admins can invite</ThemedText>
            <ThemedText variant="caption">Off means any member can share the link</ThemedText>
          </View>
          <Switch
            value={adminsOnly}
            disabled={!isAdmin || pending}
            onValueChange={(on) => onChange({ whoCanInvite: on ? 'admins' : 'members' })}
            trackColor={{ false: colors.borderStrong, true: colors.accent }}
            ios_backgroundColor={colors.borderStrong}
            testID="pref-admins-invite"
          />
        </View>
        <View style={[styles.prefRow, styles.divider]}>
          <View style={styles.prefBody}>
            <ThemedText variant="bodyStrong">Approve people who use the link</ThemedText>
            <ThemedText variant="caption">Off means the link lets them straight in</ThemedText>
          </View>
          <Switch
            value={needsApproval}
            disabled={!isAdmin || pending}
            onValueChange={(on) => onChange({ joinMode: on ? 'approval' : 'open' })}
            trackColor={{ false: colors.borderStrong, true: colors.accent }}
            ios_backgroundColor={colors.borderStrong}
            testID="pref-join-approval"
          />
        </View>
      </Card>
      <ThemedText variant="caption" style={styles.note}>
        An invite you send to someone by name always goes straight through. Approval is only for
        the link.
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 10,
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
  divider: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  note: {
    paddingHorizontal: spacing.xs,
  },
});
