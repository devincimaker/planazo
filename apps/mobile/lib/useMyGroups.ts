import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import { useAuthStore } from '../stores/authStore';

export interface MyGroup {
  id: string;
  name: string;
  color: string | null;
}

/**
 * The groups you're in, and whether we know yet.
 *
 * Three surfaces ask the same question and have to give the same answer: the
 * feed decides which empty state to show, the tab bar decides where "+" goes,
 * and the create sheet decides whether there is a plan to compose at all. A
 * plan can only go to a group, so "you're in none" is a state each of them has
 * to handle rather than a case that cannot happen (PLA-68). One query key
 * means they cannot disagree, and a screen that already warmed the cache does
 * not refetch.
 */
export function useMyGroups() {
  const { user } = useAuthStore();

  const { data, isPending } = useQuery({
    queryKey: ['my-groups', user?.id],
    queryFn: async (): Promise<MyGroup[]> => {
      const { data: rows, error } = await supabase
        .from('group_members')
        .select('groups:group_id (id, name, color)')
        .eq('user_id', user!.id);
      if (error) throw error;
      return rows
        .map((row) => row.groups as unknown as MyGroup | null)
        .filter(Boolean) as MyGroup[];
    },
    enabled: !!user,
  });

  const groups = data ?? [];

  return {
    groups,
    hasGroups: groups.length > 0,
    // A disabled query stays `isPending` forever, so a signed-out user would
    // read as "still loading" rather than "no groups". Callers use this to
    // hold off on the no-groups copy, and a permanent hold is worse than the
    // dead end it replaces.
    loading: !!user && isPending,
  };
}
