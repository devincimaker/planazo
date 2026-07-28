import { View, Pressable, StyleSheet } from 'react-native';
import { Button } from './Button';
import { ThemedText } from './ThemedText';
import { colors, radii } from '../../theme/tokens';

interface AnswerFooterProps {
  /** When set, shows the collapsed changeable answer instead of the buttons */
  answered?: 'yes' | 'no' | null;
  answerLabel?: string;
  yesLabel?: string;
  noLabel?: string;
  onYes?: () => void;
  onNo?: () => void;
  onChange?: () => void;
  size?: 'md' | 'lg';
  testID?: string;
}

/**
 * The one thing a plan asks of you. Unanswered: "Can't make it" + primary.
 * Answered: a single tinted row with "Change" — always reversible.
 */
export function AnswerFooter({
  answered = null,
  answerLabel,
  yesLabel = "I'm in",
  noLabel = "Can't make it",
  onYes,
  onNo,
  onChange,
  size = 'lg',
  testID,
}: AnswerFooterProps) {
  if (answered) {
    const isYes = answered === 'yes';
    return (
      <Pressable
        accessibilityRole="button"
        onPress={onChange}
        testID={testID}
        style={({ pressed }) => [
          styles.answeredRow,
          size === 'md' && styles.answeredRowMd,
          { backgroundColor: isYes ? colors.confirmedSoft : colors.surfaceSunken },
          pressed && styles.pressed,
        ]}
      >
        <ThemedText
          variant="bodyStrong"
          color={isYes ? colors.confirmed : colors.textSecondary}
          numberOfLines={1}
          style={styles.answerLabel}
        >
          {answerLabel ?? (isYes ? "You're in" : "You can't make it")}
        </ThemedText>
        <ThemedText
          variant="caption"
          color={isYes ? colors.confirmed : colors.textSecondary}
          style={styles.change}
        >
          Change
        </ThemedText>
      </Pressable>
    );
  }

  return (
    <View style={styles.row} testID={testID}>
      <Button
        label={noLabel}
        variant="secondary"
        size={size}
        onPress={onNo}
        style={styles.noButton}
        testID="answer-no"
      />
      <Button label={yesLabel} size={size} onPress={onYes} style={styles.yesButton} testID="answer-yes" />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  noButton: {
    flexBasis: 150,
    flexGrow: 0,
  },
  yesButton: {
    flex: 1,
  },
  answeredRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderRadius: radii.footerButton,
  },
  answeredRowMd: {
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: radii.row,
  },
  answerLabel: {
    flexShrink: 1,
  },
  change: {
    opacity: 0.75,
    paddingLeft: 12,
  },
  pressed: {
    opacity: 0.85,
  },
});
