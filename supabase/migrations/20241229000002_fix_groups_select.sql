-- Fix groups SELECT policy to allow creators to see their group immediately after creation
-- (before they've added themselves as a member)

DROP POLICY IF EXISTS "Group members can view their groups" ON public.groups;

CREATE POLICY "Group members can view their groups"
  ON public.groups FOR SELECT
  TO authenticated
  USING (
    created_by = auth.uid() OR public.is_group_member(id)
  );
