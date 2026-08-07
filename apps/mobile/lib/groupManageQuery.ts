import type { QueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

/**
 * The Manage screen's group query, shared with the Admins screen (PLA-50).
 *
 * One definition on purpose: both screens read `['group-manage', id]`, and the
 * cache is only actually shared while the key and the select stay identical.
 * Two hand-maintained copies of this select would drift apart silently.
 */
export function groupManageQuery(id: string | undefined) {
  return {
    queryKey: ['group-manage', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('groups')
        .select(
          `id, name, color, anyone_can_post, who_can_invite, join_mode, created_by,
          group_members(user_id, role, notify_new_plans, joined_at,
            profile:profiles(display_name, avatar_url))`
        )
        .eq('id', id)
        .single();
      if (error) throw error;
      return data as any;
    },
    enabled: !!id,
  };
}

/**
 * Every cache a membership or settings write goes stale through, in one place
 * for the same reason as the query above: Manage and Admins both mutate this
 * group, and a fourth key added to one screen must reach the other.
 */
export function invalidateGroup(queryClient: QueryClient, id: string | undefined): void {
  queryClient.invalidateQueries({ queryKey: ['group-manage', id] });
  queryClient.invalidateQueries({ queryKey: ['group', id] });
  queryClient.invalidateQueries({ queryKey: ['groups'] });
}
