import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import { useAuthStore } from '../stores/authStore';

export interface Friend {
  id: string;
  name: string;
  handle: string | null;
  avatarUrl: string | null;
}

/** Accepted friendships, either direction, as the people on the other end. */
export function useFriends() {
  const { user } = useAuthStore();

  const query = useQuery({
    queryKey: ['friends', user?.id],
    queryFn: async (): Promise<Friend[]> => {
      const { data, error } = await supabase
        .from('friendships')
        .select(
          `requester_id, addressee_id,
          requester:requester_id(id, display_name, handle, avatar_url),
          addressee:addressee_id(id, display_name, handle, avatar_url)`
        )
        .eq('status', 'accepted')
        .or(`requester_id.eq.${user?.id},addressee_id.eq.${user?.id}`);
      if (error) throw error;

      return data
        .map((f: any) => (f.requester_id === user?.id ? f.addressee : f.requester))
        .filter(Boolean)
        .map((p: any) => ({
          id: p.id,
          name: p.display_name,
          handle: p.handle,
          avatarUrl: p.avatar_url,
        }))
        .sort((a: Friend, b: Friend) => a.name.localeCompare(b.name));
    },
    enabled: !!user,
  });

  return { ...query, friends: query.data ?? [] };
}
