import { Alert } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { useLeaveFor } from './navigation';
import { contentViolation } from './moderation';
import { submitPollDraft } from './usePlanPoll';
import { pollDraftTouched, type PollDraft } from './pollDraft';
import { useAuthStore } from '../stores/authStore';

export interface CreatePlanInput {
  groupId: string | null;
  title: string;
  /** YYYY-MM-DD days. One is a fixed plan, several is a flexible one. */
  dates: string[];
  /** HH:MM, only used when the plan is fixed. */
  time: string;
  min: number;
  cap: number | null;
  location: string;
  notes: string;
  pollDraft: PollDraft;
}

/** Local wall-clock date from a YYYY-MM-DD day (plus optional time). */
const localDate = (iso: string, h = 0, m = 0) => {
  const [y = 0, mo = 1, d = 1] = iso.split('-').map(Number);
  return new Date(y, mo - 1, d, h, m);
};

/**
 * Posting a plan: the row, the host's own answer, and the optional question,
 * as one call the screen can await.
 *
 * The host counts from the start — a yes-RSVP on a fixed plan, availability on
 * every proposed day on a flexible one — which is why this is more than an
 * insert.
 *
 * The form's values arrive at `mutate()` rather than at the hook, matching
 * useVotePlanPoll: the hook is then a function of its variables instead of a
 * subscriber to whatever the screen last rendered.
 */
export function useCreatePlan() {
  const leaveFor = useLeaveFor();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  return useMutation({
    mutationFn: async (input: CreatePlanInput) => {
      const { groupId, title, dates, time, min, cap, location, notes, pollDraft } = input;
      if (!groupId || !user) throw new Error('Pick a group first');
      // Guideline 1.2: objectionable language stops here, not in review.
      const violation = contentViolation({
        'plan title': title,
        'plan description': notes,
        location,
      });
      if (violation) throw new Error(violation);
      const fixed = dates.length === 1;
      const [h, m] = time.split(':').map(Number);

      const { data: plan, error } = await supabase
        .from('plans')
        .insert({
          group_id: groupId,
          created_by: user.id,
          title: title.trim(),
          description: notes.trim() || null,
          location: location.trim() || null,
          plan_type: fixed ? 'fixed' : 'flexible',
          event_date: fixed ? localDate(dates[0]!, h, m).toISOString() : null,
          min_people: min,
          max_people: cap,
          status: 'open',
        })
        .select()
        .single();
      if (error) throw error;

      if (fixed) {
        const { error: rsvpError } = await supabase
          .from('rsvps')
          .insert({ plan_id: plan.id, user_id: user.id, response: 'yes' });
        if (rsvpError) throw rsvpError;
      } else {
        const { data: options, error: datesError } = await supabase
          .from('plan_date_options')
          .insert(dates.map((d) => ({ plan_id: plan.id, date: localDate(d).toISOString() })))
          .select();
        if (datesError) throw datesError;
        const { error: availError } = await supabase.from('date_availability').insert(
          options.map((o) => ({
            plan_id: plan.id,
            user_id: user.id,
            date_option_id: o.id,
            available: true,
          }))
        );
        if (availError) throw availError;
      }

      // The optional question rides along — submitPollDraft owns the trim
      // and the moderation gate. Born with its plan, so
      // notify_plan_poll_opened stays silent and the plan_created push
      // carries the group there.
      if (pollDraftTouched(pollDraft)) {
        await submitPollDraft(plan.id, pollDraft);
      }
      return plan;
    },
    onSuccess: (plan, input) => {
      queryClient.invalidateQueries({ queryKey: ['home-plans'] });
      queryClient.invalidateQueries({ queryKey: ['group-plans', input.groupId] });
      leaveFor(`/(app)/plan/${plan.id}`);
    },
    onError: (error: Error) => Alert.alert('Error', error.message),
  });
}
