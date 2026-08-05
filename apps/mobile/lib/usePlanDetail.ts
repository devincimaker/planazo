import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { deleteOwnRsvp, offerWaitingList } from './rsvp';
import { alertActionError } from './queryErrors';
import { useAuthStore } from '../stores/authStore';

/**
 * Every fetch and write on the plan detail screen. `onDatesCommitted` fires
 * when a date-vote send or a decline lands, before the caches invalidate —
 * the screen uses it to leave editing mode.
 */
export function usePlanDetail(id: string, { onDatesCommitted }: { onDatesCommitted: () => void }) {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();

  const { data: plan, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['plan', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('plans')
        .select(
          '*, creator:profiles!plans_created_by_fkey(display_name), canceller:profiles!plans_cancelled_by_fkey(display_name), groups(id, name, color)'
        )
        .eq('id', id)
        .single();
      if (error) throw error;
      return data as any;
    },
    enabled: !!id,
  });

  const { data: rsvps } = useQuery({
    queryKey: ['plan-rsvps', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rsvps')
        .select('*, profile:profiles(display_name)')
        .eq('plan_id', id);
      if (error) throw error;
      return data as any[];
    },
    enabled: !!id,
  });

  const { data: dateOptions } = useQuery({
    queryKey: ['plan-date-options', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('plan_date_options')
        .select('*')
        .eq('plan_id', id)
        .order('date', { ascending: true });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!id && plan?.plan_type === 'flexible',
  });

  const { data: availabilities } = useQuery({
    queryKey: ['plan-availabilities', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('date_availability')
        .select('*, profile:profiles(display_name)')
        .eq('plan_id', id);
      if (error) throw error;
      return data as any[];
    },
    enabled: !!id && plan?.plan_type === 'flexible',
  });

  const { data: membership } = useQuery({
    queryKey: ['plan-membership', plan?.group_id, user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('group_members')
        .select('role')
        .eq('group_id', plan!.group_id)
        .eq('user_id', user!.id)
        .single();
      return data;
    },
    enabled: !!plan?.group_id && !!user,
  });

  // Everyone in the circle — the menu's nudge count and 19c's "never
  // answered" line are both "members minus anyone who responded".
  const { data: memberIds } = useQuery({
    queryKey: ['plan-group-member-ids', plan?.group_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('group_members')
        .select('user_id')
        .eq('group_id', plan!.group_id);
      if (error) throw error;
      return (data as { user_id: string }[]).map((m) => m.user_id);
    },
    enabled: !!plan?.group_id,
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['plan', id] });
    queryClient.invalidateQueries({ queryKey: ['plan-rsvps', id] });
    queryClient.invalidateQueries({ queryKey: ['plan-availabilities', id] });
    queryClient.invalidateQueries({ queryKey: ['home-plans'] });
    if (plan?.group_id) {
      queryClient.invalidateQueries({ queryKey: ['group-plans', plan.group_id] });
    }
  };

  const answerRsvp = useMutation({
    mutationFn: async (response: 'yes' | 'no' | 'pending') => {
      const { error } = await supabase.from('rsvps').upsert(
        { plan_id: id, user_id: user?.id, response },
        { onConflict: 'plan_id,user_id' }
      );
      if (error) throw error;
    },
    onSuccess: invalidateAll,
    // The plan can fill between the render and the tap. Rather than a dead end,
    // offer the thing that now exists (PLA-37).
    onError: (error) => offerWaitingList(error, () => answerRsvp.mutate('pending')),
  });

  const clearRsvp = useMutation({
    mutationFn: () => deleteOwnRsvp(id, user!.id),
    onSuccess: invalidateAll,
    onError: alertActionError,
  });

  const sendDates = useMutation({
    mutationFn: async (picked: string[]) => {
      const mine = (availabilities ?? []).filter((a) => a.user_id === user?.id);
      const removed = mine.filter((a) => !picked.includes(a.date_option_id)).map((a) => a.id);

      if (picked.length > 0) {
        const rows = picked.map((optionId) => ({
          plan_id: id,
          user_id: user?.id,
          date_option_id: optionId,
          available: true,
        }));
        const { error } = await supabase
          .from('date_availability')
          .upsert(rows, { onConflict: 'plan_id,user_id,date_option_id' });
        if (error) throw error;
      }
      if (removed.length > 0) {
        const { error } = await supabase.from('date_availability').delete().in('id', removed);
        if (error) throw error;
      }
      // Sending dates supersedes a previous "no". Scoped and unconditional:
      // the server decides from its own state, not the cached rsvps — the
      // cache can lose the race with this screen turning interactive, and a
      // reopened plan's seeded "yes" is a held seat that voting again must
      // never surrender (only withdrawing may). Zero rows gone is the normal
      // first-vote case, so no deleteOwnRsvp-style assertion here.
      const { error: rsvpError } = await supabase
        .from('rsvps')
        .delete()
        .eq('plan_id', id)
        .eq('user_id', user?.id)
        .eq('response', 'no');
      if (rsvpError) throw rsvpError;
    },
    onSuccess: () => {
      onDatesCommitted();
      invalidateAll();
    },
    onError: alertActionError,
  });

  const declineAll = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('rsvps').upsert(
        { plan_id: id, user_id: user?.id, response: 'no' },
        { onConflict: 'plan_id,user_id' }
      );
      if (error) throw error;
      const mine = (availabilities ?? []).filter((a) => a.user_id === user?.id);
      if (mine.length > 0) {
        const { error: availError } = await supabase
          .from('date_availability')
          .delete()
          .in('id', mine.map((a) => a.id));
        if (availError) throw availError;
      }
    },
    onSuccess: () => {
      onDatesCommitted();
      invalidateAll();
    },
    onError: alertActionError,
  });

  const lockPlan = useMutation({
    mutationFn: async (dateOptionId: string) => {
      const { data, error } = await supabase.rpc('lock_plan', {
        p_plan_id: id,
        p_date_option_id: dateOptionId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: invalidateAll,
    onError: alertActionError,
  });

  const reopenPlan = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('reopen_plan', { p_plan_id: id });
      if (error) throw error;
    },
    onSuccess: invalidateAll,
    onError: alertActionError,
  });

  // Un-cancel (19b). The RPC restores locked/open, keeps everyone in, and
  // tells them it's back on.
  const restorePlan = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('restore_plan', { p_plan_id: id });
      if (error) throw error;
    },
    onSuccess: invalidateAll,
    onError: alertActionError,
  });

  return {
    plan,
    isLoading,
    isError,
    error,
    refetch,
    rsvps,
    dateOptions,
    availabilities,
    membership,
    memberIds,
    answerRsvp,
    clearRsvp,
    sendDates,
    declineAll,
    lockPlan,
    reopenPlan,
    restorePlan,
  };
}
