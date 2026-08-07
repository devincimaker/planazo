import { View, StyleSheet, Pressable } from 'react-native';
import { ThemedText, Card } from '../ui';
import { PrefSwitchRow, settingsStyles } from './PrefSwitchRow';
import { colors } from '../../theme/tokens';

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
    <View style={settingsStyles.section}>
      <ThemedText variant="sectionLabel">How it runs</ThemedText>
      <Card padded={false}>
        <PrefSwitchRow
          label="Anyone can post plans"
          caption="Off means only admins can"
          value={anyoneCanPost}
          disabled={!isAdmin || anyoneCanPostPending}
          onChange={onAnyoneCanPost}
          testID="pref-anyone-can-post"
        />
        <PrefSwitchRow
          label="Notify me on new plans"
          caption="Push as soon as something lands"
          value={notify}
          disabled={notifyPending}
          onChange={onNotify}
          divided
          testID="pref-notify"
        />
        {isAdmin ? (
          <>
            <Pressable
              style={({ pressed }) => [
                settingsStyles.prefRow,
                settingsStyles.divider,
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
                settingsStyles.prefRow,
                settingsStyles.divider,
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
  prefBody: {
    flex: 1,
    gap: 3,
  },
  rowPressed: {
    backgroundColor: colors.surfaceSunken,
  },
});
