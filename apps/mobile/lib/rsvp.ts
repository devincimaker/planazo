import { supabase } from './supabase';

/**
 * Clears your answer on a plan and proves the row actually went.
 *
 * A DELETE that RLS filters out is not an error: PostgREST answers 200 with
 * no rows, so `error` is null and the caller happily invalidates and redraws
 * identical state. That silence is what made "Change" a dead button on every
 * answered plan (PLA-16). Asking for the deleted rows back turns it loud.
 */
export async function deleteOwnRsvp(planId: string, userId: string): Promise<void> {
  const { data, error } = await supabase
    .from('rsvps')
    .delete()
    .eq('plan_id', planId)
    .eq('user_id', userId)
    .select('plan_id');

  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("Your answer couldn't be changed. The plan may have been called off.");
  }
}
