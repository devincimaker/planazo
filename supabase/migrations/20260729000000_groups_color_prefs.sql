-- Groups suite (design 6a-6e): stored group colour, posting pref, per-member
-- notification pref, and a leave RPC that hands admin off before departure.
--
-- Colour: groups.color stores one of the five design swatches. Existing rows
-- are backfilled with the same hash the app used client-side (colorForName in
-- apps/mobile/components/ui/Avatar.tsx) so no group changes colour when the
-- screens switch to the stored value. Rows without a colour stay NULL and the
-- app keeps falling back to the hash.

ALTER TABLE public.groups ADD COLUMN color TEXT;
ALTER TABLE public.groups ADD COLUMN anyone_can_post BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.group_members ADD COLUMN notify_new_plans BOOLEAN NOT NULL DEFAULT true;

-- Mirror of colorForName(): h = (h * 31 + charCodeAt(i)) | 0 over the name,
-- then groupColors[abs(h) % 5]. ascii() returns code points, charCodeAt
-- returns UTF-16 units; they agree for everything except astral chars
-- (emoji), which would merely land on a different valid swatch.
CREATE OR REPLACE FUNCTION public.color_for_name(p_name TEXT)
RETURNS TEXT AS $$
DECLARE
  h BIGINT := 0;
  i INT;
  swatches TEXT[] := ARRAY['#F7B0DC', '#8FC7E8', '#F6C453', '#B7E4C7', '#E5D4F5'];
BEGIN
  FOR i IN 1..length(p_name) LOOP
    h := h * 31 + ascii(substr(p_name, i, 1));
    h := ((h + 2147483648) % 4294967296 + 4294967296) % 4294967296 - 2147483648;
  END LOOP;
  RETURN swatches[(abs(h) % 5) + 1];
END;
$$ LANGUAGE plpgsql IMMUTABLE;

UPDATE public.groups SET color = public.color_for_name(name) WHERE color IS NULL;

-- 6e "Anyone can post plans" toggle: off restricts plan creation to admins.
DROP POLICY IF EXISTS "Group members can create plans" ON public.plans;
CREATE POLICY "Group members can create plans"
  ON public.plans FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND (
      public.is_group_admin(group_id)
      OR (
        public.is_group_member(group_id)
        AND (SELECT g.anyone_can_post FROM public.groups g WHERE g.id = group_id)
      )
    )
  );

-- Members flip their own notification pref through an RPC: a bare UPDATE
-- policy on group_members would also open `role` to self-edits.
CREATE OR REPLACE FUNCTION public.set_group_notify(p_group_id UUID, p_notify BOOLEAN)
RETURNS VOID AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.group_members
  SET notify_new_plans = p_notify
  WHERE group_id = p_group_id AND user_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not a member of this group';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 6e "Leave": the existing on-delete trigger drops the caller's RSVPs and
-- availability; this RPC additionally promotes the longest-standing member
-- when the last admin walks out ("Someone else keeps admin") and deletes the
-- group entirely when the last member leaves (an empty group is unreachable).
CREATE OR REPLACE FUNCTION public.leave_group(p_group_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_heir UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT role INTO v_role FROM public.group_members
  WHERE group_id = p_group_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not a member of this group';
  END IF;

  IF v_role = 'admin' AND NOT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = p_group_id AND role = 'admin' AND user_id <> v_uid
  ) THEN
    SELECT user_id INTO v_heir FROM public.group_members
    WHERE group_id = p_group_id AND user_id <> v_uid
    ORDER BY joined_at ASC LIMIT 1;

    IF v_heir IS NOT NULL THEN
      UPDATE public.group_members SET role = 'admin'
      WHERE group_id = p_group_id AND user_id = v_heir;
    END IF;
  END IF;

  DELETE FROM public.group_members
  WHERE group_id = p_group_id AND user_id = v_uid;

  IF NOT EXISTS (
    SELECT 1 FROM public.group_members WHERE group_id = p_group_id
  ) THEN
    DELETE FROM public.groups WHERE id = p_group_id;
    RETURN jsonb_build_object('left', true, 'group_deleted', true);
  END IF;

  RETURN jsonb_build_object('left', true, 'promoted', v_heir);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.set_group_notify(UUID, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.leave_group(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_group_notify(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.leave_group(UUID) TO authenticated;
