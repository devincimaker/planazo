import { View, Pressable, StyleSheet, ActionSheetIOS, Alert, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import type { PlanDerived } from '../../lib/planDerived';
import { MIN_TOUCH_TARGET } from '../../lib/a11y';
import { ThemedText, showToast } from '../ui';
import { colors, spacing } from '../../theme/tokens';

type Props = {
  planId: string;
  groupId?: string | null;
  d: PlanDerived;
  groupName: string;
  onNudge: () => void;
};

/** The back label, the ··· menu, and the menu itself (20a). */
export function PlanTopBar({ planId, groupId, d, groupName, onNudge }: Props) {
  const router = useRouter();

  const copyLink = async () => {
    await Clipboard.setStringAsync(`planazo://plan/${planId}`);
    showToast('Link copied');
  };

  // 20a: the host menu. Guests get it minus the two host rows — editing and
  // calling it off share one guard, because both are meaningless on a plan
  // that has already ended or been called off (PLA-31).
  const showMenu = () => {
    const rows: { label: string; action: () => void; destructive?: boolean }[] = [
      { label: 'Copy invite link', action: copyLink },
    ];
    if (d.isOpen && !d.isPast && d.unanswered > 0) {
      rows.push({
        label: `Nudge the ${d.unanswered} who ${d.unanswered === 1 ? "hasn't" : "haven't"} answered`,
        action: onNudge,
      });
    }
    if (d.isHost && !d.isCancelled && !d.isPast) {
      rows.push({
        label: 'Edit the details',
        action: () => router.push(`/plan/${planId}/edit`),
      });
      rows.push({
        label: 'Call it off',
        action: () => router.push(`/plan/${planId}/cancel`),
        destructive: true,
      });
    }
    if (Platform.OS === 'ios') {
      const destructive = rows.findIndex((r) => r.destructive);
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...rows.map((r) => r.label), 'Cancel'],
          cancelButtonIndex: rows.length,
          destructiveButtonIndex: destructive >= 0 ? destructive : undefined,
        },
        (i) => rows[i]?.action()
      );
    } else {
      Alert.alert('Plan options', undefined, [
        ...rows.map((r) => ({
          text: r.label,
          style: r.destructive ? ('destructive' as const) : undefined,
          onPress: r.action,
        })),
        { text: 'Close', style: 'cancel' as const },
      ]);
    }
  };

  return (
    <View style={styles.topBar}>
      {/* Deep links (push, QA) mount this as the first screen — fall back
          to where the label points */}
      <Pressable
        onPress={() =>
          router.canGoBack()
            ? router.back()
            : router.replace(groupId ? `/(app)/group/${groupId}` : '/(app)/(tabs)')
        }
        accessibilityRole="button"
        testID="back"
        style={styles.navAction}
      >
        <ThemedText variant="bodyStrong" color={colors.accent}>
          ‹ {groupName}
        </ThemedText>
      </Pressable>
      <Pressable
        onPress={showMenu}
        accessibilityRole="button"
        accessibilityLabel="Plan options"
        testID="plan-menu"
        style={[styles.navAction, styles.navActionEnd]}
      >
        <ThemedText variant="bodyStrong" color={colors.textMuted} style={styles.dots}>
          ···
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  // This bar was already exactly 44 tall (12 + 20 + 12) while the two things
  // in it were 20 — the clearest case in the app of a target that should have
  // filled its bar and didn't. Moving the padding onto the buttons changes
  // nothing visually and makes the whole bar tappable (PLA-40).
  navAction: {
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET,
  },
  // "···" is about 30 wide, so the end action needs the width floor too; it
  // grows leftwards and the glyph stays flush.
  navActionEnd: {
    alignItems: 'flex-end',
    minWidth: MIN_TOUCH_TARGET,
  },
  dots: {
    letterSpacing: 2,
    fontSize: 19,
  },
});
