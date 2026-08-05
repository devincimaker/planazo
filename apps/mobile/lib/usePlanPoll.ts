import { Alert } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { contentViolation } from './moderation';
import { cleanPollDraft, type PollDraft } from './pollDraft';
import { actionErrorCopy, isForbiddenError } from './queryErrors';

/**
 * The invalidation contract for everything poll-shaped: realtime.ts, the
 * vote mutation below and the two composer paths all invalidate this key.
 */
export const planPollKey = (planId: string) => ['plan-poll', planId] as const;

export interface PollOptionRow {
  id: string;
  label: string;
  position: number;
}

export interface PollVoteRow {
  option_id: string;
  user_id: string;
  profile: { display_name: string } | null;
}

export interface PlanPollRow {
  id: string;
  question: string;
  created_at: string;
  plan_poll_options: PollOptionRow[];
  plan_poll_votes: PollVoteRow[];
}

/**
 * A plan's polls, oldest first, each with its options and every attributed
 * vote (names show against every option). An empty list is a real answer —
 * most plans never carry a question — so the section renders the host's
 * "+ Add a poll" invitation or nothing at all, the same locked-door rule the
 * photo album follows.
 */
export function usePlanPolls(planId: string) {
  return useQuery({
    queryKey: planPollKey(planId),
    queryFn: async (): Promise<PlanPollRow[]> => {
      const { data, error } = await supabase
        .from('plan_polls')
        .select(
          // The options embed names its FK: the composite (poll_id, plan_id)
          // key is one of two ways PostgREST could reach the options table,
          // and it refuses to guess.
          'id, question, created_at, ' +
            'plan_poll_options!plan_poll_options_poll_id_plan_id_fkey(id, label, position), ' +
            'plan_poll_votes(option_id, user_id, profile:profiles(display_name))'
        )
        .eq('plan_id', planId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data as unknown as PlanPollRow[];
    },
  });
}

/**
 * The whole submit path — trim, moderate, insert question then options — in
 * one place, because the create sheet and the new-poll sheet both walk it
 * and the moderation gate is exactly the part that must not drift between
 * them. Throws with user-facing copy on a violation. position is explicit
 * because one INSERT gives every option the same created_at.
 */
export async function submitPollDraft(planId: string, draft: PollDraft): Promise<void> {
  const { question, options } = cleanPollDraft(draft);

  // Guideline 1.2: objectionable language stops here, not in review.
  const violation = contentViolation({ question, option: options.join(' ') });
  if (violation) throw new Error(violation);

  const { data: poll, error } = await supabase
    .from('plan_polls')
    .insert({ plan_id: planId, question })
    .select('id')
    .single();
  if (error) throw error;

  const { error: optionsError } = await supabase.from('plan_poll_options').insert(
    options.map((label, i) => ({
      poll_id: poll.id,
      plan_id: planId,
      label,
      position: i,
    }))
  );
  if (optionsError) throw optionsError;
}

/**
 * Copy for a refused vote. The generic forbidden copy reads "you're not in
 * the group", which is flatly wrong for someone looking at the plan — a vote
 * is refused because they are not in the *plan*. Reachable even with the
 * client gating correctly, because the gate can go stale: withdraw your yes
 * on another device and the rows you are looking at still take a tap.
 */
function voteErrorCopy(error: unknown): { title: string; body: string } {
  if (isForbiddenError(error)) {
    return {
      title: "Say you're in first",
      body: 'Voting is for people who are in this plan. Answer yes and you get a pick.',
    };
  }
  return actionErrorCopy(error);
}

/**
 * The one vote write, shared by the plan screen and the feed card so the
 * single-choice contract — the (poll_id, user_id) conflict key, delete as
 * withdrawal — lives in exactly one place. optionId null withdraws. Owns its
 * own invalidation and refusal copy; callers just call mutate.
 */
export function useVotePlanPoll() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      planId,
      pollId,
      userId,
      optionId,
    }: {
      planId: string;
      pollId: string;
      userId: string;
      optionId: string | null;
    }) => {
      if (optionId === null) {
        const { error } = await supabase
          .from('plan_poll_votes')
          .delete()
          .eq('poll_id', pollId)
          .eq('user_id', userId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('plan_poll_votes').upsert(
          { poll_id: pollId, plan_id: planId, user_id: userId, option_id: optionId },
          { onConflict: 'poll_id,user_id' }
        );
        if (error) throw error;
      }
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: planPollKey(vars.planId) });
      queryClient.invalidateQueries({ queryKey: ['home-plans'] });
    },
    onError: (error: unknown) => {
      const { title, body } = voteErrorCopy(error);
      Alert.alert(title, body);
    },
  });
}
