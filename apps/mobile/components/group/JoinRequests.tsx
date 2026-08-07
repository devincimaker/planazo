import { View, StyleSheet } from 'react-native';
import { ThemedText, Card, Avatar, Button } from '../ui';
import { settingsStyles } from './PrefSwitchRow';
import { radii, spacing } from '../../theme/tokens';
import type { JoinRequest } from '../../lib/useGroupDoor';

interface Props {
  requests: JoinRequest[];
  /** The row being answered right now, which stops taking taps. */
  answeringId: string | null;
  onRespond: (userId: string, approve: boolean) => void;
}

/**
 * People who used the link while the door was on approval, waiting for an
 * admin to open it.
 *
 * The section disappears entirely when nobody is waiting. An empty "Asking to
 * join" heading on every visit would be a permanent reminder of a feature most
 * groups never switch on.
 *
 * Declining says nothing to the person who asked, which is why there is no
 * "Decline" here: "Not now" is what the admin is choosing, and the person is
 * simply left where they were, free to ask again.
 */
export function JoinRequests({ requests, answeringId, onRespond }: Props) {
  if (requests.length === 0) return null;

  return (
    <View style={settingsStyles.section} testID="join-requests">
      <ThemedText variant="sectionLabel">
        Asking to join{requests.length > 1 ? ` · ${requests.length}` : ''}
      </ThemedText>
      <Card padded={false}>
        {requests.map((r, index) => (
          <View
            key={r.id}
            style={[styles.row, index > 0 && settingsStyles.divider]}
            testID={`request-${r.userId}`}
          >
            <Avatar name={r.name} size={36} imageUrl={r.avatarUrl} />
            <ThemedText variant="bodyStrong" numberOfLines={1} style={styles.name}>
              {r.name}
            </ThemedText>
            <Button
              label="Not now"
              variant="secondary"
              size="md"
              style={styles.answer}
              disabled={answeringId === r.userId}
              onPress={() => onRespond(r.userId, false)}
              testID={`decline-${r.userId}`}
            />
            <Button
              label="Let in"
              size="md"
              style={styles.answer}
              disabled={answeringId === r.userId}
              onPress={() => onRespond(r.userId, true)}
              testID={`approve-${r.userId}`}
            />
          </View>
        ))}
      </Card>
      <ThemedText variant="caption" style={settingsStyles.note}>
        They used your invite link. Nobody is told when you pick Not now.
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  name: {
    flex: 1,
    minWidth: 0,
  },
  // Two answers side by side on a roster row, so they take the pill rather
  // than Button's default row radius: rounder reads as lighter next to a name.
  answer: {
    paddingHorizontal: 13,
    borderRadius: radii.pill,
  },
});
