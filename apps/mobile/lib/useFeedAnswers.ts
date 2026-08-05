import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type RsvpResponse } from '@planazo/shared';
import { supabase } from './supabase';
import { deleteOwnRsvp, offerWaitingList } from './rsvp';
import { alertActionError } from './queryErrors';
import { useAuthStore } from '../stores/authStore';

/**
 * The feed's four answer writes — yes/no/wait on a fixed plan, clearing an
 * answer, sending picked dates, declining a flexible plan — with their
 * invalidations and refusal copy, on the useCreatePlan precedent: the hook
 * is a function of its variables, and the card just calls back with a plan id.
 *
 * The screen owns the uncommitted date picks, so `onDatesSent` is how it
 * hears that a send landed and the picks for that plan should clear.
 */
export function useFeedAnswers({ onDatesSent }: { onDatesSent: (planId: string) => void }) {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['home-plans'] });
  };

  const answerFixed = useMutation({
    mutationFn: async ({ planId, response }: { planId: string; response: RsvpResponse }) => {
      const { error } = await supabase.from('rsvps').upsert(
        { plan_id: planId, user_id: user?.id, response },
        { onConflict: 'plan_id,user_id' }
      );
      if (error) throw error;
    },
    onSuccess: invalidate,
    // The plan can fill between the render and the tap. Rather than a dead end,
    // offer the thing that now exists (PLA-37).
    onError: (error, variables) =>
      offerWaitingList(error, () =>
        answerFixed.mutate({ planId: variables.planId, response: 'pending' })
      ),
  });

  const clearAnswer = useMutation({
    mutationFn: (planId: string) => deleteOwnRsvp(planId, user!.id),
    onSuccess: invalidate,
    onError: alertActionError,
  });

  const sendDates = useMutation({
    mutationFn: async ({ planId, optionIds }: { planId: string; optionIds: string[] }) => {
      const rows = optionIds.map((optionId) => ({
        plan_id: planId,
        user_id: user?.id,
        date_option_id: optionId,
        available: true,
      }));
      const { error } = await supabase
        .from('date_availability')
        .upsert(rows, { onConflict: 'plan_id,user_id,date_option_id' });
      if (error) throw error;
    },
    onSuccess: (_data, { planId }) => {
      onDatesSent(planId);
      invalidate();
    },
    onError: alertActionError,
  });

  const declineFlexible = useMutation({
    mutationFn: async ({ planId, optionIds }: { planId: string; optionIds: string[] }) => {
      const { error } = await supabase.from('rsvps').upsert(
        { plan_id: planId, user_id: user?.id, response: 'no' },
        { onConflict: 'plan_id,user_id' }
      );
      if (error) throw error;
      if (optionIds.length > 0) {
        const { error: availError } = await supabase
          .from('date_availability')
          .delete()
          .eq('user_id', user!.id)
          .in('date_option_id', optionIds);
        if (availError) throw availError;
      }
    },
    onSuccess: invalidate,
    onError: alertActionError,
  });

  return {
    answer: (planId: string, response: RsvpResponse) =>
      answerFixed.mutate({ planId, response }),
    clearAnswer: (planId: string) => clearAnswer.mutate(planId),
    sendDates: (planId: string, optionIds: string[]) =>
      sendDates.mutate({ planId, optionIds }),
    decline: (planId: string, optionIds: string[]) =>
      declineFlexible.mutate({ planId, optionIds }),
  };
}
