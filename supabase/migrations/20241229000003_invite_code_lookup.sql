-- Allow looking up a group by invite code (for joining)
-- This bypasses RLS since non-members need to find the group

CREATE OR REPLACE FUNCTION public.get_group_by_invite_code(code TEXT)
RETURNS TABLE (id UUID, name TEXT) AS $$
BEGIN
  RETURN QUERY
  SELECT g.id, g.name
  FROM public.groups g
  WHERE g.invite_code = UPPER(TRIM(code));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.get_group_by_invite_code(TEXT) TO authenticated;
