import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { alertActionError } from './queryErrors';
import { useAuthStore } from '../stores/authStore';

export interface CancelNotice {
  noticeId: string;
  plan: any;
}

/**
 * 19e: a cancellation of a plan you'd said yes to earns one dismissable
 * notice above the feed. The unread plan_cancelled row *is* the pin — the
 * RPC only writes them for people who were in, and 24h clears it either way.
 *
 * Called by the feed screen, not the notices component, so the fetch starts
 * alongside the plans query instead of waiting behind it.
 */
export function useCancelNotices() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['cancel-notices', user?.id],
    queryFn: async (): Promise<CancelNotice[]> => {
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { data: notes, error } = await supabase
        .from('notifications')
        .select('id, data, created_at')
        .eq('user_id', user!.id)
        .eq('type', 'plan_cancelled')
        .eq('read', false)
        .gte('created_at', since)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const planIds = [
        ...new Set(notes.map((n: any) => n.data?.plan_id).filter(Boolean)),
      ];
      if (planIds.length === 0) return [];
      const { data: cancelledPlans, error: planError } = await supabase
        .from('plans')
        .select(
          'id, title, status, event_date, locked_date, cancel_reason, canceller:profiles!plans_cancelled_by_fkey(display_name)'
        )
        .in('id', planIds);
      if (planError) throw planError;
      const byId = new Map(cancelledPlans.map((p: any) => [p.id, p]));
      return notes
        .map((n: any) => ({ noticeId: n.id as string, plan: byId.get(n.data?.plan_id) }))
        // A restored plan takes its notice with it
        .filter((n: any) => n.plan && n.plan.status === 'cancelled');
    },
    enabled: !!user,
  });

  const dismissNotice = useMutation({
    mutationFn: async (noticeId: string) => {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('id', noticeId);
      if (error) throw error;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['cancel-notices'] }),
    onError: alertActionError,
  });

  return {
    notices: data ?? [],
    dismiss: (noticeId: string) => dismissNotice.mutate(noticeId),
  };
}
