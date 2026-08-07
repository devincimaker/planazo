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
          `id, name, color, invite_code, anyone_can_post,
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
