import { View, StyleSheet, Pressable, Switch } from 'react-native';
import { ThemedText, Card } from '../ui';
import { colors, spacing } from '../../theme/tokens';

interface Props {
  /** Group-wide: off means only admins can post plans. Admins only. */
  anyoneCanPost: boolean;
  onAnyoneCanPost: (on: boolean) => void;
  anyoneCanPostPending: boolean;
  /** This user's own push preference for this group. */
  notify: boolean;
  onNotify: (on: boolean) => void;
  notifyPending: boolean;
  isAdmin: boolean;
  /** "Just you" or "N people run this group" — the Admins row's subtitle. */
  adminSummary: string;
  onEditProfile: () => void;
  onAdmins: () => void;
}

/** "How it runs": the two switches, plus the way in to the group profile. */
export function GroupPrefsCard({
  anyoneCanPost,
  onAnyoneCanPost,
  anyoneCanPostPending,
  notify,
  onNotify,
  notifyPending,
  isAdmin,
  adminSummary,
  onEditProfile,
  onAdmins,
}: Props) {
  return (
    <View style={styles.section}>
      <ThemedText variant="sectionLabel">How it runs</ThemedText>
      <Card padded={false}>
        <View style={styles.prefRow}>
          <View style={styles.prefBody}>
            <ThemedText variant="bodyStrong">Anyone can post plans</ThemedText>
            <ThemedText variant="caption">Off means only admins can</ThemedText>
          </View>
          <Switch
            value={anyoneCanPost}
            disabled={!isAdmin || anyoneCanPostPending}
            onValueChange={onAnyoneCanPost}
            trackColor={{ false: colors.borderStrong, true: colors.accent }}
            ios_backgroundColor={colors.borderStrong}
            testID="pref-anyone-can-post"
          />
        </View>
        <View style={[styles.prefRow, styles.divider]}>
          <View style={styles.prefBody}>
            <ThemedText variant="bodyStrong">Notify me on new plans</ThemedText>
            <ThemedText variant="caption">Push as soon as something lands</ThemedText>
          </View>
          <Switch
            value={notify}
            disabled={notifyPending}
            onValueChange={onNotify}
            trackColor={{ false: colors.borderStrong, true: colors.accent }}
            ios_backgroundColor={colors.borderStrong}
            testID="pref-notify"
          />
        </View>
        {isAdmin ? (
          <>
            <Pressable
              style={({ pressed }) => [
                styles.prefRow,
                styles.divider,
                pressed && styles.rowPressed,
              ]}
              onPress={onAdmins}
              accessibilityRole="button"
              testID="manage-admins"
            >
              <View style={styles.prefBody}>
                <ThemedText variant="bodyStrong">Admins</ThemedText>
                <ThemedText variant="caption">{adminSummary}</ThemedText>
              </View>
              <ThemedText variant="body" color={colors.textFaint}>
                ›
              </ThemedText>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.prefRow,
                styles.divider,
                pressed && styles.rowPressed,
              ]}
              onPress={onEditProfile}
              accessibilityRole="button"
              testID="edit-group"
            >
              <ThemedText variant="bodyStrong">Edit group profile</ThemedText>
              <ThemedText variant="body" color={colors.textFaint}>
                ›
              </ThemedText>
            </Pressable>
          </>
        ) : null}
      </Card>
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
  rowPressed: {
    backgroundColor: colors.surfaceSunken,
  },
});
