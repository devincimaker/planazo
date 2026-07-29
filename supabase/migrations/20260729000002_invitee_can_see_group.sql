-- A pending invitee sees "Group" instead of the group's name: the 18b invite
-- card shows the group's name, colour and member names to someone who is NOT
-- a member yet, but the groups/group_members SELECT policies were
-- members-only. Extend both to people holding a pending invite — that's
-- precisely the information the card is designed to show them.

DROP POLICY IF EXISTS "Group members can view their groups" ON public.groups;
CREATE POLICY "Group members can view their groups"
  ON public.groups FOR SELECT
  TO authenticated
  USING (
    created_by = auth.uid()
    OR public.is_group_member(id)
    OR EXISTS (
      SELECT 1 FROM public.group_invites gi
      WHERE gi.group_id = groups.id
        AND gi.invitee_id = auth.uid()
        AND gi.status = 'pending'
    )
  );

DROP POLICY IF EXISTS "Users can view memberships in their groups" ON public.group_members;
CREATE POLICY "Users can view memberships in their groups"
  ON public.group_members FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_group_member(group_id)
    OR EXISTS (
      SELECT 1 FROM public.group_invites gi
      WHERE gi.group_id = group_members.group_id
        AND gi.invitee_id = auth.uid()
        AND gi.status = 'pending'
    )
  );
