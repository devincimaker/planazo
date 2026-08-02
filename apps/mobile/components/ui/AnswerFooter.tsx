import { Pressable, StyleSheet } from 'react-native';
import { ButtonRow } from './ButtonRow';
import { ThemedText } from './ThemedText';
import { MIN_TOUCH_TARGET } from '../../lib/a11y';
import { colors, radii } from '../../theme/tokens';

/**
 * The three ways a plan can already have been answered. Green for a place you
 * hold, ember for one you are waiting on, grey for one you turned down.
 */
const tones = {
  yes: { bg: colors.confirmedSoft, fg: colors.confirmed, label: "You're in" },
  pending: {
    bg: colors.waitingSoft,
    fg: colors.waiting,
    label: "You're on the waiting list",
  },
  no: { bg: colors.surfaceSunken, fg: colors.textSecondary, label: "You can't make it" },
} as const;

interface AnswerFooterProps {
  /** When set, shows the collapsed changeable answer instead of the buttons */
  answered?: 'yes' | 'no' | 'pending' | null;
  answerLabel?: string;
  yesLabel?: string;
  noLabel?: string;
  /** What the primary says once the plan is full and joining means queueing. */
  waitLabel?: string;
  /**
   * Every place is taken, so saying yes would be refused (PLA-20). Only affects
   * the unanswered state — someone already in is unaffected by the plan being
   * full, and must keep their way out.
   *
   * With `onWait` this offers the waiting list (PLA-37); without it the primary
   * falls back to the dead "Full" button, so a caller that has not been taught
   * about queueing cannot accidentally promise one.
   */
  full?: boolean;
  onYes?: () => void;
  onNo?: () => void;
  onWait?: () => void;
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
  waitLabel = 'Take the next spot',
  full = false,
  onYes,
  onNo,
  onWait,
  onChange,
  size = 'lg',
  testID,
}: AnswerFooterProps) {
  if (answered) {
    const tone = tones[answered];
    return (
      <Pressable
        accessibilityRole="button"
        onPress={onChange}
        testID={testID}
        style={({ pressed }) => [
          styles.answeredRow,
          size === 'md' && styles.answeredRowMd,
          { backgroundColor: tone.bg },
          pressed && styles.pressed,
        ]}
      >
        <ThemedText
          variant="bodyStrong"
          color={tone.fg}
          numberOfLines={1}
          style={styles.answerLabel}
        >
          {answerLabel ?? tone.label}
        </ThemedText>
        <ThemedText variant="caption" color={tone.fg} style={styles.change}>
          Change
        </ThemedText>
      </Pressable>
    );
  }

  // "Can't make it" stays live on a full plan: declining still takes you off
  // the list of people it's waiting on, and it's the honest answer to give.
  //
  // A full plan offers the queue rather than refusing (PLA-37), in the outline
  // accent rather than the filled ember: taking a place in a line is a smaller
  // thing than saying you'll be there, and the button should say so.
  return (
    <ButtonRow
      size={size}
      testID={testID}
      secondary={{ label: noLabel, variant: 'secondary', onPress: onNo, testID: 'answer-no' }}
      primary={
        full
          ? {
              label: onWait ? waitLabel : 'Full',
              variant: 'accentOutline',
              disabled: !onWait,
              onPress: onWait,
              testID: 'answer-wait',
            }
          : { label: yesLabel, onPress: onYes, testID: 'answer-yes' }
      }
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
    // The only way back out of an answer — `md` sat at 42 (11 + 20 + 11).
    minHeight: MIN_TOUCH_TARGET,
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
