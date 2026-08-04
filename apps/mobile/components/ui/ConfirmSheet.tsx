import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Button } from './Button';
import { ThemedText } from './ThemedText';
import { colors, spacing } from '../../theme/tokens';

interface ConfirmSheetProps {
  visible: boolean;
  title: string;
  body: string;
  /** The word on the ember button: "Remove", "Block". */
  actionLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  testID?: string;
}

/**
 * The in-app confirmation from the "Group Manage Swipe" design: a card that
 * rises from the bottom rather than a system alert.
 *
 * It exists because the swipe already put the destructive act in brand colours
 * and a system alert answers in someone else's — but it has to earn the swap.
 * `Modal` gives us the back-button dismissal and the focus trap that `Alert`
 * has for free; `accessibilityViewIsModal` stops VoiceOver wandering into the
 * member list behind it.
 */
export function ConfirmSheet({
  visible,
  title,
  body,
  actionLabel,
  onConfirm,
  onCancel,
  testID,
}: ConfirmSheetProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        {/* Tapping the dimmed area is a cancel, the same as the button. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          testID={testID ? `${testID}-backdrop` : undefined}
        />
        <View
          style={styles.sheet}
          accessibilityViewIsModal
          accessibilityRole="alert"
          testID={testID}
        >
          <ThemedText variant="cardTitle">{title}</ThemedText>
          <ThemedText variant="body" color={colors.textSecondary}>
            {body}
          </ThemedText>
          <View style={styles.buttons}>
            <Button
              label={actionLabel}
              onPress={onConfirm}
              variant="primary"
              numberOfLines={0}
              testID={testID ? `${testID}-confirm` : undefined}
            />
            <Button
              label="Cancel"
              onPress={onCancel}
              variant="outline"
              numberOfLines={0}
              testID={testID ? `${testID}-cancel` : undefined}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(23,18,21,0.42)',
    justifyContent: 'flex-end',
    padding: spacing.xl,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    paddingTop: spacing.xxl,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  buttons: {
    gap: 10,
    paddingTop: spacing.md,
  },
});
