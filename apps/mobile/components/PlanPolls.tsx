import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { countPollVotes, pollLeaders, pollVotedPhrase } from '@planazo/shared';
import { ThemedText } from './ui/ThemedText';
import { Badge } from './ui/Badge';
import { AvatarStack } from './ui/AvatarStack';
import { usePlanPolls, useVotePlanPoll, type PlanPollRow } from '../lib/usePlanPoll';
import { colors, spacing } from '../theme/tokens';

interface Props {
  planId: string;
  userId: string;
  /** Host or group admin: sees the add-a-poll invitation. */
  isHost: boolean;
  /**
   * How many people are in the plan — the denominator of "3 of 5 voted" and
   * of every option's bar.
   */
  peopleIn: number;
  /**
   * Whether the viewer holds a pick: in the plan, or its host. Everyone in
   * the group reads the tally; only the people going get a vote, which makes
   * the poll one more reason to answer.
   */
  canVote: boolean;
  /** Cancelled or past: the tally stays as the record, but nothing moves. */
  planEnded: boolean;
}

/**
 * The polls a plan carries (PLA-47): one section per question, each folding
 * to a single row with the two facts worth keeping — what's leading and
 * where you stand — because several polls on one plan is a scroll problem.
 * One pick each, tap another to move it, tap your own to drop it, and the
 * tally just runs: nothing closes it, the poll lives as long as the plan.
 *
 * Owns its own query and mutations, like PhotoAlbumCard: the detail screen
 * is over the file-size cap pending its split (PLA-58), so features land
 * beside it, not inside it.
 */
export function PlanPolls({ planId, userId, isHost, peopleIn, canVote, planEnded }: Props) {
  const router = useRouter();
  const { data: polls, isLoading } = usePlanPolls(planId);
  const vote = useVotePlanPoll();
  // Which sections are unfolded. Unvisited polls fall back to "first one
  // open, the rest folded", the reading order the design settles on.
  const [open, setOpen] = useState<Record<string, boolean>>({});

  if (isLoading) return null;
  const list = polls ?? [];
  const showAdd = isHost && !planEnded;
  if (list.length === 0 && !showAdd) return null;

  const live = canVote && !planEnded;

  return (
    <View style={styles.sections}>
      {list.map((poll, index) => {
        const expanded = open[poll.id] ?? index === 0;
        return (
          <PollSection
            key={poll.id}
            poll={poll}
            userId={userId}
            peopleIn={peopleIn}
            live={live}
            expanded={expanded}
            onToggle={() => setOpen((o) => ({ ...o, [poll.id]: !expanded }))}
            onPick={(optionId, mine) =>
              vote.mutate({ planId, pollId: poll.id, userId, optionId: mine ? null : optionId })
            }
          />
        );
      })}

      {showAdd ? (
        <Pressable
          // peopleIn rides along so the sheet's "The 5 who are in" row costs
          // no second fetch — this card is the sheet's only entry point.
          onPress={() => router.push(`/plan/${planId}/poll?peopleIn=${peopleIn}`)}
          accessibilityRole="button"
          testID="poll-add"
          style={styles.addCard}
        >
          <ThemedText variant="bodyStrong" color={colors.accent}>
            {list.length === 0 ? '+ Add a poll' : '+ Add another poll'}
          </ThemedText>
          <ThemedText variant="caption" color={colors.textMuted} style={styles.addHint}>
            {list.length === 0
              ? 'Let them pick the film, the place, who brings what'
              : 'Only you can add one'}
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

function PollSection({
  poll,
  userId,
  peopleIn,
  live,
  expanded,
  onToggle,
  onPick,
}: {
  poll: PlanPollRow;
  userId: string;
  peopleIn: number;
  live: boolean;
  expanded: boolean;
  onToggle: () => void;
  onPick: (optionId: string, mine: boolean) => void;
}) {
  const options = [...poll.plan_poll_options].sort((a, b) => a.position - b.position);
  const votes = poll.plan_poll_votes;
  const counts = countPollVotes(options, votes);
  const { leaders, maxVotes } = pollLeaders(options, votes);
  const leadId = leaders[0]?.id ?? null;
  const votedCount = votes.length;
  const myOptionId = votes.find((v) => v.user_id === userId)?.option_id ?? null;
  const myPick = options.find((o) => o.id === myOptionId) ?? null;

  const caption = pollVotedPhrase(votedCount, peopleIn);

  const namesFor = (optionId: string) =>
    votes
      .filter((v) => v.option_id === optionId)
      .map((v) => (v.user_id === userId ? 'You' : v.profile?.display_name ?? '?'))
      // You first, the way the going row leads with you.
      .sort((a, b) => (a === 'You' ? -1 : b === 'You' ? 1 : 0));

  return (
    <View style={styles.section} testID={`poll-section-${poll.id}`}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        testID={`poll-toggle-${poll.id}`}
        style={styles.header}
      >
        <ThemedText variant="sectionLabel" style={styles.headerLabel} numberOfLines={1}>
          {poll.question}
        </ThemedText>
        <View style={styles.headerMeta}>
          <ThemedText variant="caption" color={colors.textMuted}>
            {caption}
          </ThemedText>
          <ThemedText variant="caption" color={colors.accent} style={styles.chevron}>
            {expanded ? '⌃' : '⌄'}
          </ThemedText>
        </View>
      </Pressable>

      {!expanded ? (
        // Folded: the two facts worth keeping — what's leading, where you stand.
        <Pressable
          onPress={onToggle}
          accessibilityRole="button"
          testID={`poll-lead-${poll.id}`}
          style={styles.leadRow}
        >
          <View style={styles.leadLeft}>
            <ThemedText variant="bodyStrong" style={styles.optionLabel} numberOfLines={1}>
              {leaders[0]?.label ?? 'Nothing yet'}
            </ThemedText>
            {leadId ? <Badge label="Leading" tone="muted" uppercase /> : null}
          </View>
          {live ? (
            <ThemedText variant="caption" color={colors.textMuted} numberOfLines={1}>
              {myPick ? `You picked ${myPick.label}` : "You haven't voted"}
            </ThemedText>
          ) : null}
        </Pressable>
      ) : (
        <>
          {options.map((opt) => {
            const mine = opt.id === myOptionId;
            const count = counts[opt.id];
            const names = namesFor(opt.id);
            const ratio = peopleIn > 0 ? Math.min(count / peopleIn, 1) : 0;
            return (
              <Pressable
                key={opt.id}
                disabled={!live}
                onPress={() => onPick(opt.id, mine)}
                accessibilityRole={live ? 'button' : undefined}
                accessibilityState={{ selected: mine, disabled: !live }}
                accessibilityLabel={`${opt.label}, ${count} ${count === 1 ? 'vote' : 'votes'}`}
                testID={`poll-option-${opt.id}`}
                style={[styles.optionRow, !live && styles.optionRowQuiet, mine && styles.optionRowMine]}
              >
                <View style={styles.optionTop}>
                  <View style={styles.optionLeft}>
                    <ThemedText
                      variant="bodyStrong"
                      color={
                        mine
                          ? colors.accentPressed
                          : live
                            ? colors.textPrimary
                            : colors.textSecondary
                      }
                      style={styles.optionLabel}
                      numberOfLines={1}
                    >
                      {opt.label}
                    </ThemedText>
                    {opt.id === leadId ? <Badge label="Leading" tone="muted" uppercase /> : null}
                  </View>
                  <View style={styles.optionMeta}>
                    <ThemedText
                      variant="caption"
                      color={mine ? colors.accentPressed : colors.textMuted}
                      testID={`poll-count-${opt.id}`}
                    >
                      {count === 1 ? '1 vote' : `${count} votes`}
                    </ThemedText>
                    <ThemedText variant="bodyStrong" color={colors.accent} style={styles.mark}>
                      {mine ? '✓' : ''}
                    </ThemedText>
                  </View>
                </View>
                {live && names.length > 0 ? <AvatarStack names={names} size={22} /> : null}
                <View style={styles.track}>
                  <View
                    style={[
                      styles.fill,
                      {
                        width: `${Math.round(ratio * 100)}%`,
                        backgroundColor: live ? colors.accent : colors.textFaint,
                      },
                    ]}
                  />
                </View>
              </Pressable>
            );
          })}
          <ThemedText variant="caption" color={colors.textMuted} style={styles.footnote}>
            {!live
              ? "Say you're in and you get a pick."
              : maxVotes === 0
                ? 'Be the first. One pick each, changeable any time.'
                : 'One pick each. Tap another to change it. The poll stays open as long as the plan does.'}
          </ThemedText>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sections: {
    gap: spacing.lg,
  },
  section: {
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 44,
  },
  headerLabel: {
    flexShrink: 1,
  },
  headerMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  chevron: {
    fontSize: 15,
    width: 14,
    textAlign: 'center',
  },
  leadRow: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 20,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    minHeight: 44,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  leadLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
  },
  optionRow: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 20,
    padding: spacing.lg,
    gap: 9,
  },
  optionRowQuiet: {
    backgroundColor: colors.surfaceSunken,
    borderColor: 'transparent',
  },
  optionRowMine: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  optionTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  optionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minWidth: 0,
    flexShrink: 1,
  },
  optionLabel: {
    fontSize: 16,
    flexShrink: 1,
  },
  optionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  mark: {
    width: 14,
    textAlign: 'center',
  },
  track: {
    height: 6,
    borderRadius: 999,
    backgroundColor: colors.divider,
    overflow: 'hidden',
  },
  fill: {
    height: 6,
    borderRadius: 999,
  },
  footnote: {
    lineHeight: 19,
  },
  addCard: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    borderRadius: 20,
    padding: spacing.lg,
    alignItems: 'center',
    gap: 4,
    minHeight: 44,
    justifyContent: 'center',
  },
  addHint: {
    textAlign: 'center',
    lineHeight: 19,
  },
});
