import { Alert } from 'react-native';
import { supabase } from './supabase';
import { actionErrorCopy, isPlanFullError } from './queryErrors';

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

// "3rd in line". English ordinals: 11th/12th/13th are the exceptions that stop
// this being a lookup on the last digit alone.
const ordinal = (n: number) => {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
};

/**
 * Where you stand in the queue (PLA-37). Position 1 gets its own words: "1st"
 * is right but "next" is what a person would say, and it's the one position
 * worth reacting to.
 *
 * A null position means the row says pending but its place hasn't arrived in
 * this client yet — the honest fallback is the front of the queue, since that
 * is where a fresh waiter on an empty list actually is.
 */
export function waitingLabel(position: number | null): string {
  return position === 1 || position == null
    ? "You're next in line"
    : `You're ${ordinal(position)} in line`;
}

/**
 * What to do when a write fails: for a full plan, offer the waiting list;
 * for anything else, the usual alert.
 *
 * Both screens show "Take the next spot" instead of "I'm in" once they can see
 * the plan is full, so this is the race — the last place went between the
 * render and the tap. The database is the authority and it said no (PT409),
 * which since PLA-37 is the fallback path rather than the normal one.
 */
export function offerWaitingList(error: unknown, onJoin: () => void): void {
  const { title, body } = actionErrorCopy(error);
  if (!isPlanFullError(error)) {
    Alert.alert(title, body);
    return;
  }
  Alert.alert(title, body, [
    { text: 'Not now', style: 'cancel' },
    { text: 'Take the next spot', onPress: onJoin },
  ]);
}
