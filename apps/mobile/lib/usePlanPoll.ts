import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';

/**
 * The invalidation contract for everything poll-shaped: realtime.ts and the
 * card's own mutations both invalidate this key, and the detail screen's
 * host menu shares the cache through it, so "does this plan have a question
 * yet" costs no second fetch.
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
}

export interface PlanPollRow {
  id: string;
  question: string;
  suggestions_open: boolean;
  closed_at: string | null;
  winner_option_id: string | null;
  closer: { display_name: string } | null;
  plan_poll_options: PollOptionRow[];
  plan_poll_votes: PollVoteRow[];
}

/**
 * A plan's one open question, its options and every vote, as a single nested
 * read. Null is a real answer — most plans never carry a question — so the
 * card renders nothing rather than an empty state, the same locked-door rule
 * the photo album follows.
 */
/**
 * The question and its options, written in the order the host typed them.
 * Shared by the create sheet and the ask screen so the two paths cannot
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

export function usePlanPoll(planId: string | undefined) {
  return useQuery({
    queryKey: planPollKey(planId ?? ''),
    enabled: !!planId,
    queryFn: async (): Promise<PlanPollRow | null> => {
      const { data, error } = await supabase
        .from('plan_polls')
        .select(
          // The options embed names its FK: winner_option_id gives these two
          // tables a second relationship, and PostgREST refuses to guess.
          'id, question, suggestions_open, closed_at, winner_option_id, ' +
            'closer:profiles!plan_polls_closed_by_fkey(display_name), ' +
            'plan_poll_options!plan_poll_options_poll_id_plan_id_fkey(id, label, position), ' +
            'plan_poll_votes(option_id, user_id)'
        )
        .eq('plan_id', planId!)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as PlanPollRow | null;
    },
  });
}
