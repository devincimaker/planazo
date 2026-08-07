import { View, StyleSheet, Pressable } from 'react-native';
import { MIN_TOUCH_TARGET } from '../../lib/a11y';
import { ThemedText, Card, Avatar } from '../ui';
import { colors, radii, spacing } from '../../theme/tokens';
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
    <View style={styles.section} testID="join-requests">
      <ThemedText variant="sectionLabel">
        Asking to join{requests.length > 1 ? ` · ${requests.length}` : ''}
      </ThemedText>
      <Card padded={false}>
        {requests.map((r, index) => (
          <View
            key={r.id}
            style={[styles.row, index > 0 && styles.divider]}
            testID={`request-${r.userId}`}
          >
            <Avatar name={r.name} size={36} imageUrl={r.avatarUrl} />
            <ThemedText variant="bodyStrong" numberOfLines={1} style={styles.name}>
              {r.name}
            </ThemedText>
            <Pressable
              accessibilityRole="button"
              disabled={answeringId === r.userId}
              onPress={() => onRespond(r.userId, false)}
              style={({ pressed }) => [styles.answer, pressed && styles.answerPressed]}
              testID={`decline-${r.userId}`}
            >
              <ThemedText variant="bodyStrong" color={colors.textSecondary}>
                Not now
              </ThemedText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={answeringId === r.userId}
              onPress={() => onRespond(r.userId, true)}
              style={({ pressed }) => [
                styles.answer,
                styles.answerPrimary,
                pressed && styles.answerPressed,
              ]}
              testID={`approve-${r.userId}`}
            >
              <ThemedText variant="bodyStrong" color={colors.textOnAccent}>
                Let in
              </ThemedText>
            </Pressable>
          </View>
        ))}
      </Card>
      <ThemedText variant="caption" style={styles.note}>
        They used your invite link. Nobody is told when you pick Not now.
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  divider: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  name: {
    flex: 1,
    minWidth: 0,
  },
  // Two buttons on one row, so they carry the 44 themselves rather than
  // leaning on the row's padding (PLA-40).
  answer: {
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 13,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
  },
  answerPrimary: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  answerPressed: {
    opacity: 0.7,
  },
  note: {
    paddingHorizontal: spacing.xs,
  },
});
