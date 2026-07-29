-- People layer (design 17b/17c, 18a/b): handles, friendships, group invites.
--
-- Handles are permanent (profile design: "your handle stays put") — generated
-- at signup from the display name, never updated. Find-people (17b) is a
-- prefix match on handle and name; profiles were already SELECT-open to
-- authenticated users, while plans/groups stay membership-scoped, which is
-- the 17b privacy contract ("no plans, no circles, until you're connected").

ALTER TABLE public.profiles ADD COLUMN handle TEXT UNIQUE;

-- Lowercased, deaccented, alphanumeric slug of a display name, with a
-- numeric suffix on collision ("rocio", "rocio1", ...).
CREATE OR REPLACE FUNCTION public.generate_handle(p_base TEXT)
RETURNS TEXT AS $$
DECLARE
  v_slug TEXT;
  v_handle TEXT;
  v_n INT := 0;
BEGIN
  v_slug := lower(regexp_replace(
    translate(p_base,
      'ÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇáàäâãéèëêíìïîóòöôõúùüûñç',
      'AAAAAEEEEIIIIOOOOOUUUUNCaaaaaeeeeiiiiooooouuuunc'),
    '[^a-zA-Z0-9]', '', 'g'));
  IF v_slug = '' THEN
    v_slug := 'planazo';
  END IF;

  v_handle := v_slug;
  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE handle = v_handle) LOOP
    v_n := v_n + 1;
    v_handle := v_slug || v_n::TEXT;
  END LOOP;
  RETURN v_handle;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Backfill oldest-first so earlier users get the clean slug.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT id, display_name FROM public.profiles
    WHERE handle IS NULL ORDER BY created_at
  LOOP
    UPDATE public.profiles
    SET handle = public.generate_handle(r.display_name)
    WHERE id = r.id;
  END LOOP;
END $$;

-- New signups get a handle from the same generator (the existing
-- on_auth_user_created trigger keeps pointing at this function).
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_name TEXT;
BEGIN
  v_name := COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1));
  INSERT INTO public.profiles (id, email, display_name, handle)
  VALUES (NEW.id, NEW.email, v_name, public.generate_handle(v_name));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- FRIENDSHIPS (17b Add -> Requested -> 18b Accept/Ignore)
-- ============================================

CREATE TABLE public.friendships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  addressee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'ignored')) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  CHECK (requester_id <> addressee_id)
);

-- One row per pair regardless of direction.
CREATE UNIQUE INDEX idx_friendships_pair
  ON public.friendships (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id));
CREATE INDEX idx_friendships_addressee ON public.friendships(addressee_id, status);
CREATE INDEX idx_friendships_requester ON public.friendships(requester_id, status);

ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Parties can view their friendships"
  ON public.friendships FOR SELECT
  TO authenticated
  USING (requester_id = auth.uid() OR addressee_id = auth.uid());

-- Sending and responding go through RPCs (send auto-accepts a crossing
-- request; respond guards which side may flip status). Either party can
-- DELETE: the requester to cancel, either friend to unfriend.
CREATE POLICY "Parties can delete their friendships"
  ON public.friendships FOR DELETE
  TO authenticated
  USING (requester_id = auth.uid() OR addressee_id = auth.uid());

CREATE OR REPLACE FUNCTION public.send_friend_request(p_addressee UUID)
RETURNS JSONB AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_row public.friendships%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_addressee = v_uid THEN
    RAISE EXCEPTION 'Cannot befriend yourself';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_addressee) THEN
    RAISE EXCEPTION 'No such person';
  END IF;

  SELECT * INTO v_row FROM public.friendships
  WHERE (requester_id = v_uid AND addressee_id = p_addressee)
     OR (requester_id = p_addressee AND addressee_id = v_uid)
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.friendships (requester_id, addressee_id)
    VALUES (v_uid, p_addressee);
    RETURN jsonb_build_object('status', 'requested');
  END IF;

  IF v_row.status = 'accepted' THEN
    RETURN jsonb_build_object('status', 'already_friends');
  END IF;

  -- Their request was already on the table (pending, or one I ignored):
  -- me adding them is consent from both sides.
  IF v_row.requester_id = p_addressee THEN
    UPDATE public.friendships
    SET status = 'accepted', responded_at = NOW()
    WHERE id = v_row.id;
    RETURN jsonb_build_object('status', 'accepted');
  END IF;

  RETURN jsonb_build_object('status', 'already_requested');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.respond_friend_request(p_friendship_id UUID, p_accept BOOLEAN)
RETURNS JSONB AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_row public.friendships%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_row FROM public.friendships
  WHERE id = p_friendship_id FOR UPDATE;
  IF NOT FOUND OR v_row.addressee_id <> v_uid THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  IF v_row.status = 'accepted' THEN
    RETURN jsonb_build_object('status', 'already_friends');
  END IF;

  UPDATE public.friendships
  SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'ignored' END,
      responded_at = NOW()
  WHERE id = p_friendship_id;

  RETURN jsonb_build_object('status', CASE WHEN p_accept THEN 'accepted' ELSE 'ignored' END);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================
-- GROUP INVITES (6d picker -> 18b sheet; the share link stays the other path)
-- ============================================

CREATE TABLE public.group_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  invited_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  invitee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'ignored')) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  UNIQUE (group_id, invitee_id)
);

CREATE INDEX idx_group_invites_invitee ON public.group_invites(invitee_id, status);
CREATE INDEX idx_group_invites_group ON public.group_invites(group_id);

ALTER TABLE public.group_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Invitee and group members can view invites"
  ON public.group_invites FOR SELECT
  TO authenticated
  USING (invitee_id = auth.uid() OR public.is_group_member(group_id));

CREATE POLICY "Inviter or admins can withdraw invites"
  ON public.group_invites FOR DELETE
  TO authenticated
  USING (invited_by = auth.uid() OR public.is_group_admin(group_id));

-- Inviting goes through an RPC so a stale row from an earlier membership
-- (unique group+invitee) can be reset to pending instead of erroring.
CREATE OR REPLACE FUNCTION public.invite_to_group(p_group_id UUID, p_invitee UUID)
RETURNS JSONB AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_row public.group_invites%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = p_group_id AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Only members can invite';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = p_group_id AND user_id = p_invitee
  ) THEN
    RETURN jsonb_build_object('status', 'already_member');
  END IF;

  SELECT * INTO v_row FROM public.group_invites
  WHERE group_id = p_group_id AND invitee_id = p_invitee FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.group_invites (group_id, invited_by, invitee_id)
    VALUES (p_group_id, v_uid, p_invitee);
    RETURN jsonb_build_object('status', 'invited');
  END IF;

  IF v_row.status = 'pending' THEN
    RETURN jsonb_build_object('status', 'already_invited');
  END IF;

  UPDATE public.group_invites
  SET status = 'pending', invited_by = v_uid, created_at = NOW(), responded_at = NULL
  WHERE id = v_row.id;
  RETURN jsonb_build_object('status', 'invited');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.respond_group_invite(p_invite_id UUID, p_accept BOOLEAN)
RETURNS JSONB AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_row public.group_invites%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_row FROM public.group_invites
  WHERE id = p_invite_id FOR UPDATE;
  IF NOT FOUND OR v_row.invitee_id <> v_uid THEN
    RAISE EXCEPTION 'Invite not found';
  END IF;

  IF v_row.status <> 'pending' THEN
    RETURN jsonb_build_object('status', v_row.status, 'group_id', v_row.group_id);
  END IF;

  UPDATE public.group_invites
  SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'ignored' END,
      responded_at = NOW()
  WHERE id = p_invite_id;

  IF p_accept THEN
    INSERT INTO public.group_members (group_id, user_id, role)
    VALUES (v_row.group_id, v_uid, 'member')
    ON CONFLICT (group_id, user_id) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'status', CASE WHEN p_accept THEN 'accepted' ELSE 'ignored' END,
    'group_id', v_row.group_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.generate_handle(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.send_friend_request(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.respond_friend_request(UUID, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.invite_to_group(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.respond_group_invite(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_friend_request(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_friend_request(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invite_to_group(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_group_invite(UUID, BOOLEAN) TO authenticated;
