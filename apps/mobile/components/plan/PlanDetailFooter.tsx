import { View, StyleSheet } from 'react-native';
import { fmtDay } from '../../lib/dates';
import { waitingLabel } from '../../lib/rsvp';
import type { PlanDerived } from '../../lib/planDerived';
import { ThemedText, Button, ButtonRow, AnswerFooter, FooterBar } from '../ui';
import { colors, fonts, spacing } from '../../theme/tokens';

type Props = {
  d: PlanDerived;
  editing: boolean;
  picked: string[];
  onAnswer: (response: 'yes' | 'no' | 'pending') => void;
  onClearRsvp: () => void;
  onStartEdit: () => void;
  onSendDates: () => void;
  onDeclineAll: () => void;
  onRestore: () => void;
  onTryAgain: () => void;
  onHeight: (height: number) => void;
};

/**
 * The floating answer bar and everything it can become: reopen, try again,
 * yes/no, the waitlist state, and the date-vote editor. Renders nothing at
 * all when the plan owes the viewer no action — the bar is removed, not
 * emptied (19a).
 */
export function PlanDetailFooter({
  d,
  editing,
  picked,
  onAnswer,
  onClearRsvp,
  onStartEdit,
  onSendDates,
  onDeclineAll,
  onRestore,
  onTryAgain,
  onHeight,
}: Props) {
  const renderContent = () => {
    // 19b: reopen lives on the host's cancelled screen only, and only while
    // the date is still ahead. Everyone else gets no footer at all — the
    // screen is purely a record.
    if (d.isCancelled) {
      if (d.isHost && !d.isPast) {
        return (
          <View style={styles.footerEnded}>
            <Button
              label="Reopen this plan"
              variant="accentOutline"
              onPress={onRestore}
              testID="restore"
            />
            <ThemedText variant="caption" color={colors.textMuted} style={styles.footerNote}>
              Everyone who was in stays in. They just get told it's back on. Only you see this
              {d.lastDate ? `, and only until ${fmtDay(d.lastDate)}` : ''}.
            </ThemedText>
          </View>
        );
      }
      return null;
    }

    // 19c: anyone in the circle can try again — a copy, not a handover.
    if (d.isExpired) {
      return (
        <View style={styles.footerEnded}>
          <Button
            label="Try again with a new date"
            variant="accentOutline"
            onPress={onTryAgain}
            testID="try-again"
          />
          <ThemedText variant="caption" color={colors.textMuted} style={styles.footerNote}>
            Opens a fresh plan with the same title, place and minimum.
          </ThemedText>
        </View>
      );
    }

    if (!d.isOpenFlexible) {
      // Fixed plans and locked flexible plans: a plain yes/no
      if (d.userRsvp?.response === 'pending') {
        return (
          <View style={styles.footerWaiting}>
            <AnswerFooter
              answered="pending"
              answerLabel={waitingLabel(d.waitPosition)}
              onChange={onClearRsvp}
            />
            <ThemedText variant="caption" color={colors.textMuted} style={styles.footerNote}>
              If a spot opens, it's yours. We'll tell you.
            </ThemedText>
          </View>
        );
      }
      if (d.userRsvp?.response === 'yes' || d.userRsvp?.response === 'no') {
        return <AnswerFooter answered={d.userRsvp.response} onChange={onClearRsvp} />;
      }
      return (
        <AnswerFooter
          full={d.isFull}
          onYes={() => onAnswer('yes')}
          onNo={() => onAnswer('no')}
          onWait={() => onAnswer('pending')}
        />
      );
    }

    // Open flexible: date voting
    if (!editing) {
      if (d.userRsvp?.response === 'no') {
        return <AnswerFooter answered="no" onChange={onClearRsvp} />;
      }
      return (
        <AnswerFooter
          answered="yes"
          answerLabel={`You sent ${d.myPickIds.length} date${d.myPickIds.length === 1 ? '' : 's'}`}
          onChange={onStartEdit}
        />
      );
    }

    return (
      <ButtonRow
        secondary={{
          label: 'None of them',
          variant: 'secondary',
          onPress: onDeclineAll,
          testID: 'decline-all',
        }}
        primary={
          picked.length === 0
            ? {
                label: 'Tap the dates you can do',
                variant: 'secondary',
                disabled: true,
                haptic: false,
              }
            : {
                label:
                  d.myPickIds.length > 0
                    ? 'Update your dates'
                    : `Send ${picked.length} date${picked.length === 1 ? '' : 's'}`,
                onPress: onSendDates,
              }
        }
      />
    );
  };

  // 19a: the footer bar is removed, not emptied — no bar at all when there
  // is nothing to press.
  const content = renderContent();
  if (!content) return null;

  return (
    <FooterBar
      pinned
      onLayout={(e) => onHeight(e.nativeEvent.layout.height)}
      testID="plan-footer"
    >
      {content}
    </FooterBar>
  );
}

const styles = StyleSheet.create({
  footerEnded: {
    gap: spacing.sm + 1,
  },
  footerWaiting: {
    gap: spacing.sm + 1,
  },
  footerNote: {
    textAlign: 'center',
    fontFamily: fonts.body,
    lineHeight: 18,
  },
});
