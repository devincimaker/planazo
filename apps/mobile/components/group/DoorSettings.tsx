import { View } from 'react-native';
import { ThemedText, Card } from '../ui';
import { PrefSwitchRow, settingsStyles } from './PrefSwitchRow';
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
  const locked = !isAdmin || pending;

  return (
    <View style={settingsStyles.section}>
      <ThemedText variant="sectionLabel">Who gets in</ThemedText>
      <Card padded={false}>
        <PrefSwitchRow
          label="Only admins can invite"
          caption="Off means any member can share the link"
          value={adminsOnly}
          disabled={locked}
          onChange={(on) => onChange({ whoCanInvite: on ? 'admins' : 'members' })}
          testID="pref-admins-invite"
        />
        <PrefSwitchRow
          label="Approve people who use the link"
          caption="Off means the link lets them straight in"
          value={needsApproval}
          disabled={locked}
          onChange={(on) => onChange({ joinMode: on ? 'approval' : 'open' })}
          divided
          testID="pref-join-approval"
        />
      </Card>
      <ThemedText variant="caption" style={settingsStyles.note}>
        An invite you send to someone by name always goes straight through. Approval is only for
        the link.
      </ThemedText>
    </View>
  );
}
