import { View, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { usePendingInvites } from '../../lib/usePendingInvites';
import { ThemedText, Avatar } from '../ui';
import { colors, radii, spacing } from '../../theme/tokens';

/** The collapsed invites pill above the group list. Renders nothing when the inbox is empty. */
export function InvitesRow() {
  const router = useRouter();
  const { groupInvites, friendRequests, count: inviteCount } = usePendingInvites();

  if (inviteCount === 0) return null;

  // Faces + "Padel Dilluns, Aina Roig and 1 more" for the collapsed row (18a)
  const inviteLabels = [
    ...groupInvites.map((i) => i.groupName),
    ...friendRequests.map((r) => r.personName),
  ];
  const inviteLine =
    inviteLabels.slice(0, 2).join(', ') +
    (inviteLabels.length > 2 ? ` and ${inviteLabels.length - 2} more` : '');

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push('/(app)/invites')}
      style={({ pressed }) => [styles.invitesRow, pressed && styles.pressed]}
      testID="invites-row"
    >
      <View style={styles.invitesFaces}>
        {inviteLabels.slice(0, 3).map((name, i) => (
          <View key={`${name}-${i}`} style={[styles.invitesFace, i > 0 && styles.invitesFaceOverlap]}>
            <Avatar name={name} size={30} />
          </View>
        ))}
      </View>
      <View style={styles.invitesBody}>
        <ThemedText variant="bodyStrong" color={colors.background}>
          {inviteCount} invite{inviteCount === 1 ? '' : 's'}
        </ThemedText>
        <ThemedText variant="caption" color={colors.textFaint} numberOfLines={1}>
          {inviteLine}
        </ThemedText>
      </View>
      <ThemedText variant="body" color={colors.tabInactive}>
        ›
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  invitesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    backgroundColor: colors.ink,
    borderRadius: 20,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    marginBottom: 22,
  },
  invitesFaces: {
    flexDirection: 'row',
  },
  invitesFace: {
    borderWidth: 2,
    borderColor: colors.ink,
    borderRadius: radii.pill,
  },
  invitesFaceOverlap: {
    marginLeft: -11,
  },
  invitesBody: {
    flex: 1,
    gap: spacing.xxs,
  },
  pressed: {
    opacity: 0.8,
  },
});
