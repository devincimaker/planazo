import { View, StyleSheet, Pressable } from 'react-native';
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
import { waitingLabel } from '../../lib/rsvp';
import { colors, spacing } from '../../theme/tokens';

const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

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
  userRsvp: any;
  rsvpDriven: boolean;
  isFull: boolean;
  waitPosition: number | null;
  myDates: number;
  when: string;
  goingNames: string[];
  dateOptions: { id: string; date: string }[];
  countByDate: Record<string, { count: number; date: string }>;
  optionIds: string[];
}

interface FeedPlanCardProps {
  d: FeedPlan;
  /** The user's uncommitted date picks for this plan; state lives in the screen. */
  picked: string[];
  onTogglePicked: (optionId: string) => void;
  onOpen: () => void;
  onAnswer: (response: 'yes' | 'no' | 'pending') => void;
  onClearAnswer: () => void;
  onSendDates: (optionIds: string[]) => void;
  onDecline: () => void;
  onVote: (pollId: string, optionId: string | null) => void;
}

export function FeedPlanCard({
  d,
  picked,
  onTogglePicked,
  onOpen,
  onAnswer,
  onClearAnswer,
  onSendDates,
  onDecline,
  onVote,
}: FeedPlanCardProps) {
  const { plan } = d;
  const groupName = plan.groups?.name ?? 'Group';
  const groupColor = plan.groups?.color ?? colorForName(groupName);

  const renderAnswer = () => {
    // A called-off plan is a record — the notice above the feed carries it.
    if (plan.status === 'cancelled') return null;

    // Once a plan locks, the date is real and the vote is over, so a locked
    // flexible plan answers like a fixed one: a plain yes/no on your own row.
    // It has to stay reachable — locking seeds every available member into a
    // 'yes' they never tapped, and that's exactly when a clash shows up.
    if (d.rsvpDriven) {
      // The card stays dense: the position is the whole message, and the
      // promise behind it ("we'll tell you") lives on plan detail.
      if (d.userRsvp?.response === 'pending') {
        return (
          <AnswerFooter
            size="md"
            answered="pending"
            answerLabel={waitingLabel(d.waitPosition)}
            onChange={onClearAnswer}
          />
        );
      }
      if (d.userRsvp?.response === 'yes' || d.userRsvp?.response === 'no') {
        return (
          <AnswerFooter size="md" answered={d.userRsvp.response} onChange={onClearAnswer} />
        );
      }
      return (
        <AnswerFooter
          size="md"
          full={d.isFull}
          onYes={() => onAnswer('yes')}
          onNo={() => onAnswer('no')}
          onWait={() => onAnswer('pending')}
        />
      );
    }

    // Flexible: answer inline — tap the dates that work, send them (2a)
    if (d.userRsvp?.response === 'no') {
      return <AnswerFooter size="md" answered="no" onChange={onClearAnswer} />;
    }
    if (d.myDates > 0) {
      return (
        <AnswerFooter
          size="md"
          answered="yes"
          answerLabel={`You sent ${d.myDates} date${d.myDates === 1 ? '' : 's'}`}
          onChange={onOpen}
        />
      );
    }

    return (
      <View style={styles.chips}>
        {d.dateOptions.map((opt) => (
          <DateOptionRow
            key={opt.id}
            label={fmtDay(opt.date)}
            meta={`${d.countByDate[opt.id]?.count ?? 0} free`}
            selected={picked.includes(opt.id)}
            onPress={() => onTogglePicked(opt.id)}
            testID={`date-option-${opt.id}`}
          />
        ))}
        <ButtonRow
          size="md"
          style={styles.chipButtons}
          secondary={{
            label: "Can't make it",
            variant: 'secondary',
            onPress: onDecline,
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
                  onPress: () => onSendDates(picked),
                }
          }
        />
      </View>
    );
  };

  return (
    <Card stripeColor={groupColor} testID={`plan-card-${plan.id}`}>
      <Pressable onPress={onOpen}>
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
            label={d.needs ? 'Unanswered' : d.confirmed ? 'Confirmed' : 'Open'}
            tone={d.needs ? 'open' : d.confirmed ? 'confirmed' : 'muted'}
          />
        </View>

        <ThemedText variant="cardTitle" style={styles.title}>
          {plan.title}
        </ThemedText>
        <ThemedText variant="bodyStrong">{d.when}</ThemedText>
        {plan.location || plan.description ? (
          <ThemedText variant="sub" numberOfLines={1} style={styles.sub}>
            {plan.location ?? plan.description}
          </ThemedText>
        ) : null}

        {d.goingNames.length > 0 && !(plan.plan_type === 'flexible' && d.needs) ? (
          <View style={styles.faces}>
            <AvatarStack
              names={d.goingNames}
              label={
                d.goingNames.length < plan.min_people
                  ? `${d.goingNames.length} of ${plan.min_people} needed`
                  : `${d.goingNames.length} going`
              }
            />
          </View>
        ) : null}
      </Pressable>

      {/* The plan's poll, votable without opening the plan
          (PLA-47). Outside the onOpen Pressable: a tap on an
          option is a vote, never a navigation. */}
      {d.poll ? (
        <View style={styles.pollSection} testID={`poll-feed-${plan.id}`}>
          <View style={styles.pollHead}>
            <ThemedText variant="sectionLabel" style={styles.pollQuestion} numberOfLines={1}>
              {d.poll.question}
            </ThemedText>
            <ThemedText
              variant="caption"
              color={d.poll.canVote ? colors.accentPressed : colors.textMuted}
              numberOfLines={1}
              style={styles.pollCaption}
            >
              {d.poll.caption}
            </ThemedText>
          </View>
          {d.poll.options.map((opt) => (
            <DateOptionRow
              key={opt.id}
              label={opt.label}
              meta={opt.votes === 1 ? '1 vote' : `${opt.votes} votes`}
              selected={opt.mine}
              onPress={
                d.poll!.canVote
                  ? () => onVote(d.poll!.id, opt.mine ? null : opt.id)
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
