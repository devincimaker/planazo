import { View, StyleSheet, Pressable } from 'react-native';
import { type RsvpResponse } from '@planazo/shared';
import {
  ThemedText,
  Card,
  Badge,
  AvatarStack,
  AnswerFooter,
  ButtonRow,
  DateOptionRow,
  colorForName,
} from '../ui';
import { fmtDay } from '../../lib/dates';
import { waitingLabel } from '../../lib/rsvp';
import { useVotePlanPoll } from '../../lib/usePlanPoll';
import { useAuthStore } from '../../stores/authStore';
import { colors, spacing } from '../../theme/tokens';

/** One feed card's slice of the decorated plan the feed screen computes. */
export interface FeedPlan {
  plan: any;
  poll: {
    id: string;
    question: string;
    options: { id: string; label: string; votes: number; mine: boolean }[];
    caption: string;
    canVote: boolean;
  } | null;
  needs: boolean;
  confirmed: boolean;
  userRsvp?: { response: RsvpResponse | null };
  rsvpDriven: boolean;
  isFull: boolean;
  waitPosition: number | null;
  myDates: number;
  when: string;
  /** Everyone who has engaged — the faces. Wider than goingCount by design. */
  goingNames: string[];
  /** What min_people is measured against: the best single date, or yes-RSVPs. */
  goingCount: number;
  dateOptions: { id: string; date: string }[];
  countByDate: Record<string, { count: number; date: string }>;
}

interface FeedPlanCardProps {
  item: FeedPlan;
  /** The user's uncommitted date picks for this plan; state lives in the screen. */
  picked: string[];
  onTogglePicked: (planId: string, optionId: string) => void;
  onOpen: (planId: string) => void;
  onAnswer: (planId: string, response: RsvpResponse) => void;
  onClearAnswer: (planId: string) => void;
  onSendDates: (planId: string, optionIds: string[]) => void;
  onDecline: (planId: string, optionIds: string[]) => void;
}

export function FeedPlanCard({
  item,
  picked,
  onTogglePicked,
  onOpen,
  onAnswer,
  onClearAnswer,
  onSendDates,
  onDecline,
}: FeedPlanCardProps) {
  const { plan } = item;
  const { user } = useAuthStore();
  const groupName = plan.groups?.name ?? 'Group';
  const groupColor = plan.groups?.color ?? colorForName(groupName);

  // One pick each, straight from the card: another option moves the vote,
  // your own withdraws it (PLA-47). The write, its invalidations and its
  // refusal copy all live in the shared hook, same as PlanPolls.
  const voteOnPoll = useVotePlanPoll();

  const renderAnswer = () => {
    // A called-off plan is a record — the notice above the feed carries it.
    if (plan.status === 'cancelled') return null;

    // Once a plan locks, the date is real and the vote is over, so a locked
    // flexible plan answers like a fixed one: a plain yes/no on your own row.
    // It has to stay reachable — locking seeds every available member into a
    // 'yes' they never tapped, and that's exactly when a clash shows up.
    if (item.rsvpDriven) {
      // The card stays dense: the position is the whole message, and the
      // promise behind it ("we'll tell you") lives on plan detail.
      if (item.userRsvp?.response === 'pending') {
        return (
          <AnswerFooter
            size="md"
            answered="pending"
            answerLabel={waitingLabel(item.waitPosition)}
            onChange={() => onClearAnswer(plan.id)}
          />
        );
      }
      if (item.userRsvp?.response === 'yes' || item.userRsvp?.response === 'no') {
        return (
          <AnswerFooter
            size="md"
            answered={item.userRsvp.response}
            onChange={() => onClearAnswer(plan.id)}
          />
        );
      }
      return (
        <AnswerFooter
          size="md"
          full={item.isFull}
          onYes={() => onAnswer(plan.id, 'yes')}
          onNo={() => onAnswer(plan.id, 'no')}
          onWait={() => onAnswer(plan.id, 'pending')}
        />
      );
    }

    // Flexible: answer inline — tap the dates that work, send them (2a)
    if (item.userRsvp?.response === 'no') {
      return <AnswerFooter size="md" answered="no" onChange={() => onClearAnswer(plan.id)} />;
    }
    if (item.myDates > 0) {
      return (
        <AnswerFooter
          size="md"
          answered="yes"
          answerLabel={`You sent ${item.myDates} date${item.myDates === 1 ? '' : 's'}`}
          onChange={() => onOpen(plan.id)}
        />
      );
    }

    return (
      <View style={styles.chips}>
        {item.dateOptions.map((opt) => (
          <DateOptionRow
            key={opt.id}
            label={fmtDay(opt.date)}
            meta={`${item.countByDate[opt.id]?.count ?? 0} free`}
            selected={picked.includes(opt.id)}
            onPress={() => onTogglePicked(plan.id, opt.id)}
            testID={`date-option-${opt.id}`}
          />
        ))}
        <ButtonRow
          size="md"
          style={styles.chipButtons}
          secondary={{
            label: "Can't make it",
            variant: 'secondary',
            onPress: () =>
              onDecline(plan.id, item.dateOptions.map((o) => o.id)),
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
                  label: `Send ${picked.length} date${picked.length === 1 ? '' : 's'}`,
                  onPress: () => onSendDates(plan.id, picked),
                }
          }
        />
      </View>
    );
  };

  return (
    <Card stripeColor={groupColor} testID={`plan-card-${plan.id}`}>
      <Pressable onPress={() => onOpen(plan.id)}>
        <View style={styles.cardTop}>
          <View style={styles.groupRow}>
            <View style={[styles.swatch, { backgroundColor: groupColor }]} />
            <ThemedText variant="caption" color={colors.textSecondary}>
              {groupName}
            </ThemedText>
          </View>
          {/*
            Two independent facts share one slot, so the label has
            to pick. "Unanswered" is the one that is always true
            when it shows: a plan with its numbers can still be
            waiting on your reply, and the old "Needs you" claimed
            the plan was short of people when often it was not.
          */}
          <Badge
            label={item.needs ? 'Unanswered' : item.confirmed ? 'Confirmed' : 'Open'}
            tone={item.needs ? 'open' : item.confirmed ? 'confirmed' : 'muted'}
          />
        </View>

        <ThemedText variant="cardTitle" style={styles.title}>
          {plan.title}
        </ThemedText>
        <ThemedText variant="bodyStrong">{item.when}</ThemedText>
        {plan.location || plan.description ? (
          <ThemedText variant="sub" numberOfLines={1} style={styles.sub}>
            {plan.location ?? plan.description}
          </ThemedText>
        ) : null}

        {item.goingNames.length > 0 && !(plan.plan_type === 'flexible' && item.needs) ? (
          <View style={styles.faces}>
            <AvatarStack
              names={item.goingNames}
              label={
                item.goingCount < plan.min_people
                  ? `${item.goingCount} of ${plan.min_people} needed`
                  : `${item.goingCount} going`
              }
            />
          </View>
        ) : null}
      </Pressable>

      {/* The plan's poll, votable without opening the plan
          (PLA-47). Outside the onOpen Pressable: a tap on an
          option is a vote, never a navigation. */}
      {item.poll ? (
        <View style={styles.pollSection} testID={`poll-feed-${plan.id}`}>
          <View style={styles.pollHead}>
            <ThemedText variant="sectionLabel" style={styles.pollQuestion} numberOfLines={1}>
              {item.poll.question}
            </ThemedText>
            <ThemedText
              variant="caption"
              color={item.poll.canVote ? colors.accentPressed : colors.textMuted}
              numberOfLines={1}
              style={styles.pollCaption}
            >
              {item.poll.caption}
            </ThemedText>
          </View>
          {item.poll.options.map((opt) => (
            <DateOptionRow
              key={opt.id}
              label={opt.label}
              meta={opt.votes === 1 ? '1 vote' : `${opt.votes} votes`}
              selected={opt.mine}
              onPress={
                item.poll!.canVote
                  ? () =>
                      voteOnPoll.mutate({
                        planId: plan.id,
                        pollId: item.poll!.id,
                        userId: user!.id,
                        optionId: opt.mine ? null : opt.id,
                      })
                  : undefined
              }
              testID={`poll-feed-option-${opt.id}`}
            />
          ))}
        </View>
      ) : null}

      <View style={styles.answer}>{renderAnswer()}</View>
    </Card>
  );
}

const styles = StyleSheet.create({
  pollSection: {
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    gap: spacing.sm,
  },
  pollHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: spacing.md,
  },
  pollQuestion: {
    flexShrink: 0,
  },
  pollCaption: {
    flexShrink: 1,
    textAlign: 'right',
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  swatch: {
    width: 20,
    height: 20,
    borderRadius: 6,
  },
  title: {
    marginBottom: spacing.xs,
  },
  sub: {
    marginTop: spacing.xxs,
  },
  faces: {
    marginTop: spacing.md,
  },
  answer: {
    marginTop: spacing.md,
  },
  chips: {
    gap: spacing.sm,
  },
  chipButtons: {
    marginTop: spacing.xxs,
  },
});
