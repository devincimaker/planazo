import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import { actionErrorCopy, isForbiddenError } from './queryErrors';

/**
 * Copy for a refused vote. The generic forbidden copy reads "you're not in
 * the group", which is flatly wrong for someone looking at the plan — a vote
 * is refused because they are not in the *plan*. Reachable after the client
 * gates correctly, because the gate can go stale: withdraw your yes on
 * another device and the rows you are looking at still take a tap.
 */
export function voteErrorCopy(error: unknown): { title: string; body: string } {
  if (isForbiddenError(error)) {
    return {
      title: "Say you're in first",
      body: 'Voting is for people who are in this plan. Answer yes and you get a pick.',
    };
  }
  return actionErrorCopy(error);
}

/**
 * The invalidation contract for everything poll-shaped: realtime.ts, the
 * poll sections' own mutations and the feed's inline voting all invalidate
 * this key.
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
  suggestions_open: boolean;
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
export function usePlanPolls(planId: string | undefined) {
  return useQuery({
    queryKey: planPollKey(planId ?? ''),
    enabled: !!planId,
    queryFn: async (): Promise<PlanPollRow[]> => {
      const { data, error } = await supabase
        .from('plan_polls')
        .select(
          // The options embed names its FK: the composite (poll_id, plan_id)
          // key is one of two ways PostgREST could reach the options table,
          // and it refuses to guess.
          'id, question, suggestions_open, created_at, ' +
            'plan_poll_options!plan_poll_options_poll_id_plan_id_fkey(id, label, position), ' +
            'plan_poll_votes(option_id, user_id, profile:profiles(display_name))'
        )
        .eq('plan_id', planId!)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as PlanPollRow[];
    },
  });
}

/**
 * The question and its options, written in the order the host typed them.
 * Shared by the create sheet and the new-poll sheet so the two paths cannot
 * drift; both pass already-cleaned input (see cleanPollDraft). position is
 * explicit because one INSERT gives every option the same created_at.
 */
export async function insertPlanPoll(
  planId: string,
  question: string,
  options: string[]
): Promise<void> {
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
