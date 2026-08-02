import { Pressable, StyleSheet } from 'react-native';
import { ButtonRow } from './ButtonRow';
import { ThemedText } from './ThemedText';
import { colors, radii } from '../../theme/tokens';

interface AnswerFooterProps {
  /** When set, shows the collapsed changeable answer instead of the buttons */
  answered?: 'yes' | 'no' | null;
  answerLabel?: string;
  yesLabel?: string;
  noLabel?: string;
  /**
   * Every place is taken, so joining would be refused (PLA-20). Only affects
   * the unanswered state — someone already in is unaffected by the plan being
   * full, and must keep their way out.
   */
  full?: boolean;
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
  full = false,
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

  // "Can't make it" stays live on a full plan: declining still takes you off
  // the list of people it's waiting on, and it's the honest answer to give.
  return (
    <ButtonRow
      size={size}
      testID={testID}
      secondary={{ label: noLabel, variant: 'secondary', onPress: onNo, testID: 'answer-no' }}
      primary={{
        label: full ? 'Full' : yesLabel,
        disabled: full,
        onPress: onYes,
        testID: 'answer-yes',
      }}
    />
  );
}

const styles = StyleSheet.create({
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
