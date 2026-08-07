import { Alert } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import type { JoinMode, WhoCanInvite } from './groupDoor';

/** One person waiting at an approval-mode door. */
export interface JoinRequest {
  id: string;
  userId: string;
  name: string;
  avatarUrl: string | null;
}

const joinRequestsKey = (groupId: string) => ['group-join-requests', groupId];

interface RequestRow {
  id: string;
  invitee_id: string;
  profile: { display_name: string | null; avatar_url: string | null } | null;
}

/**
 * The knocks an admin can answer, and the answer.
 *
 * No shield filtering here, and deliberately: the SELECT policy on
 * group_invites already drops requests from anyone who blocked this admin, so
 * a row that arrives is one they are meant to see. Filtering client-side would
 * mean the exclusion list had to reach the client, which is exactly what RLS
 * exists to prevent.
 */
export function useJoinRequests(groupId: string, enabled: boolean) {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: joinRequestsKey(groupId),
    queryFn: async (): Promise<JoinRequest[]> => {
      const { data, error } = await supabase
        .from('group_invites')
        .select('id, invitee_id, profile:profiles!group_invites_invitee_id_fkey(display_name, avatar_url)')
        .eq('group_id', groupId)
        .eq('status', 'requested')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data as unknown as RequestRow[]).map((row) => ({
        id: row.id,
        userId: row.invitee_id,
        name: row.profile?.display_name ?? 'Someone',
        avatarUrl: row.profile?.avatar_url ?? null,
      }));
    },
    enabled: enabled && !!groupId,
  });

  const respond = useMutation({
    mutationFn: async ({ userId, approve }: { userId: string; approve: boolean }) => {
      const { error } = await supabase.rpc('respond_to_join_request', {
        p_group_id: groupId,
        p_user_id: userId,
        p_approve: approve,
      });
      if (error) throw error;
    },
    onSuccess: (_result, { approve }) => {
      queryClient.invalidateQueries({ queryKey: joinRequestsKey(groupId) });
      // Approving seats a member, so the roster the manage screen is showing
      // is now a row short of the truth. Declining moves one invite row and
      // touches nothing else, so it refetches nothing else: the group detail
      // query carries every plan, RSVP and date option in the group.
      if (!approve) return;
      queryClient.invalidateQueries({ queryKey: ['group-manage', groupId] });
      queryClient.invalidateQueries({ queryKey: ['group', groupId] });
    },
    onError: (error: Error) => Alert.alert('Error', error.message),
  });

  return {
    requests: data ?? [],
    respond,
    /** The row currently being answered, so it can stop taking taps. */
    answeringId: respond.isPending ? respond.variables.userId : null,
  };
}

/**
 * The two settings themselves. One dial per call, because they are independent
 * switches on one row and `update_group_door` writes only what it is passed —
 * sending both would let a stale copy of one ride along with the other.
 *
 * It invalidates its own keys rather than taking the screen's catch-all: the
 * door decides who sees an Invite button on the group's own screen, and it
 * decides nothing at all about the groups list.
 */
export function useDoorSettings(groupId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (door: { whoCanInvite?: WhoCanInvite; joinMode?: JoinMode }) => {
      const { error } = await supabase.rpc('update_group_door', {
        p_group_id: groupId,
        p_who_can_invite: door.whoCanInvite,
        p_join_mode: door.joinMode,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['group-manage', groupId] });
      queryClient.invalidateQueries({ queryKey: ['group', groupId] });
    },
    onError: (error: Error) => Alert.alert('Error', error.message),
  });
}
