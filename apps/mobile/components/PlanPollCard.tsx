import { ActionSheetIOS, Alert, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { countPollVotes, pollLeaders } from '@planazo/shared';
import { ThemedText } from './ui/ThemedText';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { usePlanPoll, planPollKey } from '../lib/usePlanPoll';
import { supabase } from '../lib/supabase';
import { actionErrorCopy } from '../lib/queryErrors';
import { colors, radii, spacing } from '../theme/tokens';

interface Props {
  planId: string;
  userId: string;
  /** Host or group admin: may close the vote, and break a tie. */
  isHost: boolean;
  /** Group size, for "3 of 6 have voted". */
  memberCount: number;
  /**
   * Cancelled or past. An open question dies with its plan (the card renders
   * nothing), but a decided answer is part of what happened and stays.
   */
  planEnded: boolean;
}

/**
 * The one open question a plan can carry (PLA-47): "Still to decide" while
 * the group votes, the answer once the host closes it. Single choice — one
 * vote each, tapping another option moves it, tapping your own withdraws it.
 * Deliberately a different idiom from the date rows above it (radio dots and
 * a poll-wide count, not per-row bars), so the two vote surfaces never read
 * as one list that behaves inconsistently.
 *
 * Owns its own query and mutations, like PhotoAlbumCard: the detail screen
 * is over the file-size cap pending its split (PLA-58), so features land
 * beside it, not inside it.
 */
export function PlanPollCard({ planId, userId, isHost, memberCount, planEnded }: Props) {
  const queryClient = useQueryClient();
  const { data: poll, isLoading } = usePlanPoll(planId);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: planPollKey(planId) });
    queryClient.invalidateQueries({ queryKey: ['home-plans'] });
  };

  const alertActionError = (error: unknown) => {
    const { title, body } = actionErrorCopy(error);
    Alert.alert(title, body);
  };

  const vote = useMutation({
    mutationFn: async (optionId: string) => {
      const { error } = await supabase.from('plan_poll_votes').upsert(
        { poll_id: poll!.id, plan_id: planId, user_id: userId, option_id: optionId },
        { onConflict: 'poll_id,user_id' }
      );
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: alertActionError,
  });

  const withdrawVote = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('plan_poll_votes')
        .delete()
        .eq('poll_id', poll!.id)
        .eq('user_id', userId);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: alertActionError,
  });

  const removePoll = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('plan_polls').delete().eq('id', poll!.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: alertActionError,
  });

  const close = useMutation({
    mutationFn: async (optionId: string | null) => {
      const { data, error } = await supabase.rpc('close_plan_poll', {
        p_plan_id: planId,
        p_option_id: optionId ?? undefined,
      });
      if (error) throw error;
      return data as { closed: boolean; reason?: string };
    },
    onSuccess: (result) => {
      invalidate();
      if (result.closed) return;
      // Refusals are states, not errors: the tally moved between the render
      // and the tap, or nobody has voted at all.
      if (result.reason === 'no_votes') {
        Alert.alert('Nobody has voted yet', 'Close it once somebody has, or take the question down.', [
          { text: 'Keep waiting', style: 'cancel' },
          {
            text: 'Remove the question',
            style: 'destructive',
            onPress: () => removePoll.mutate(),
          },
        ]);
      } else if (result.reason === 'tie' || result.reason === 'not_leading') {
        Alert.alert("It's changed", 'The votes moved. Have another look before closing.');
      }
    },
    onError: alertActionError,
  });

  if (isLoading || !poll) return null;

  const options = [...poll.plan_poll_options].sort((a, b) => a.position - b.position);
  const counts = countPollVotes(options, poll.plan_poll_votes);
  const { leaders } = pollLeaders(options, poll.plan_poll_votes);
  const votedCount = poll.plan_poll_votes.length;
  const myOptionId =
    poll.plan_poll_votes.find((v) => v.user_id === userId)?.option_id ?? null;
  const isClosed = !!poll.closed_at;

  // An open question dies with its plan; a decided one is part of the record.
  if (planEnded && !isClosed) return null;

  const onCloseTap = () => {
    if (leaders.length === 1) {
      close.mutate(null);
      return;
    }
    // A tie is the host's to break, from among the leaders only. Android gets
    // the same choice as a plain alert; both lists are at most a few rows.
    const labels = leaders.map((o) => o.label);
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: "It's a tie. Which one wins?",
          options: [...labels, 'Cancel'],
          cancelButtonIndex: labels.length,
        },
        (i) => {
          if (i < labels.length) close.mutate(leaders[i].id);
        }
      );
    } else {
      Alert.alert(
        "It's a tie",
        'Which one wins?',
        [
          ...leaders.map((o) => ({ text: o.label, onPress: () => close.mutate(o.id) })),
          { text: 'Cancel', style: 'cancel' as const },
        ]
      );
    }
  };

  const caption = isClosed
    ? poll.closed_at
      ? `${poll.closer?.display_name ?? 'The host'} closed it`
      : ''
    : votedCount === 0
      ? 'Tap the one you want. Nobody has voted yet'
      : myOptionId
        ? `${votedCount} of ${memberCount} have voted`
        : `Tap the one you want · ${votedCount} of ${memberCount} have voted`;

  return (
    <View style={styles.section}>
      <ThemedText variant="sectionLabel">
        {isClosed ? 'Decided' : 'Still to decide'}
      </ThemedText>
      <Card testID="plan-poll-card">
        <ThemedText variant="cardTitle" style={styles.question}>
          {poll.question}
        </ThemedText>

        {options.map((opt) => {
          const mine = opt.id === myOptionId;
          const isWinner = opt.id === poll.winner_option_id;
          const dim = isClosed && !isWinner;
          return (
            <Pressable
              key={opt.id}
              disabled={isClosed || planEnded}
              onPress={() => (mine ? withdrawVote.mutate() : vote.mutate(opt.id))}
              accessibilityRole="button"
              accessibilityState={{ selected: mine, disabled: isClosed }}
              accessibilityLabel={`${opt.label}, ${counts[opt.id]} ${
                counts[opt.id] === 1 ? 'vote' : 'votes'
              }`}
              testID={`poll-option-${opt.id}`}
              style={[styles.row, mine && !isClosed && styles.rowMine]}
            >
              {isClosed ? (
                <ThemedText
                  variant="bodyStrong"
                  color={isWinner ? colors.confirmed : colors.textFaint}
                  style={styles.mark}
                >
                  {isWinner ? '✓' : ''}
                </ThemedText>
              ) : (
                <View style={[styles.radio, mine && styles.radioMine]}>
                  {mine ? <View style={styles.radioDot} /> : null}
                </View>
              )}
              <ThemedText
                variant={isWinner || mine ? 'bodyStrong' : 'body'}
                color={
                  dim
                    ? colors.textMuted
                    : mine && !isClosed
                      ? colors.accentPressed
                      : colors.textPrimary
                }
                style={styles.label}
              >
                {opt.label}
              </ThemedText>
              <ThemedText
                variant="caption"
                color={dim ? colors.textFaint : colors.textMuted}
                testID={`poll-count-${opt.id}`}
              >
                {counts[opt.id]}
              </ThemedText>
            </Pressable>
          );
        })}

        {caption ? (
          <ThemedText variant="caption" color={colors.textMuted} style={styles.caption}>
            {caption}
          </ThemedText>
        ) : null}

        {isHost && !isClosed && !planEnded && votedCount > 0 ? (
          <View style={styles.closeWrap}>
            <Button
              label={
                close.isPending
                  ? 'Closing…'
                  : leaders.length === 1
                    ? `Go with ${leaders[0].label}`
                    : 'Break the tie'
              }
              variant="accentOutline"
              disabled={close.isPending}
              onPress={onCloseTap}
              testID="poll-close"
            />
            <ThemedText variant="caption" color={colors.textMuted} style={styles.closeNote}>
              Closing locks the answer in. Only you see this.
            </ThemedText>
          </View>
        ) : null}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.sm,
  },
  question: {
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radii.row,
    borderWidth: 1,
    borderColor: 'transparent',
    marginBottom: spacing.xs,
  },
  rowMine: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.textFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioMine: {
    borderColor: colors.accent,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.accent,
  },
  mark: {
    width: 20,
    textAlign: 'center',
  },
  label: {
    flex: 1,
  },
  caption: {
    marginTop: spacing.xs,
  },
  closeWrap: {
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  closeNote: {
    textAlign: 'center',
  },
});
