-- PLA-35: group_members INSERT was self-service.
--
-- The policy shipped in 20241229000000 read, in full:
--
--   WITH CHECK (auth.uid() = user_id)
--
-- "The row is about you" was the entire test. Nothing checked that you had
-- been invited, and nothing constrained `role`. Two consequences, both
-- reachable with nothing more than a session token and curl:
--
--   1. Anyone holding an invite link could join as `admin` rather than
--      `member`. The app sends role: 'member', but that is a client-side
--      convention; an admin can rename the group, kick people, and flip
--      anyone_can_post.
--   2. Anyone who learned a group's UUID could insert themselves into it with
--      no invite at all. Group UUIDs are not secret — they travel in deep
--      links and in every plan payload.
--
-- The policy was permissive because two client paths needed it: join-by-code
-- ((tabs)/groups.tsx) and group creation (group/new.tsx), both of which wrote
-- the membership row straight from the client. This migration moves both
-- server-side, mirroring respond_group_invite (20260729000001), and then
-- removes the policy so there is no client-writable path left at all.
--
-- After this, every row in group_members is written by a SECURITY DEFINER
-- function that decides the role itself:
--
--   create_group              -> creator, 'admin'
--   join_group_by_invite_code -> code holder, 'member'
--   respond_group_invite      -> named invitee, 'member'
--   leave_group               -> promotes the heir when the last admin goes
--
-- The one remaining way to become an admin is to create the group or to
-- inherit it, which is the rule the product always intended.


-- create_group: the group row and its creator's admin membership, atomically.
--
-- Atomicity is the second bug this fixes. The client did two sequential
-- inserts, so a failure between them left a group with no members — and by
-- the SELECT policy on groups (membership-based) nobody could see it, and by
-- the DELETE policy (admin-based) nobody could remove it. An invisible,
-- undeletable row.
--
-- The invite code moves server-side with it. The client's generator drew 8
-- chars and hoped; a collision surfaced as a raw unique-violation on a screen
-- that had no idea what to say about it. Here a collision just costs another
-- draw. 32^8 makes that vanishingly rare, but "rare" and "handled" are
-- different things.
CREATE OR REPLACE FUNCTION public.create_group(
  p_name TEXT,
  p_description TEXT DEFAULT NULL,
  p_color TEXT DEFAULT NULL
)
RETURNS public.groups AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_name TEXT := NULLIF(TRIM(p_name), '');
  v_group public.groups%ROWTYPE;
  v_attempt INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'A group needs a name';
  END IF;

  FOR v_attempt IN 1..5 LOOP
    BEGIN
      INSERT INTO public.groups (name, description, color, invite_code, created_by)
      VALUES (
        v_name,
        NULLIF(TRIM(COALESCE(p_description, '')), ''),
        COALESCE(p_color, public.color_for_name(v_name)),
        public.generate_invite_code(),
        v_uid
      )
      RETURNING * INTO v_group;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      -- groups.invite_code is the only unique column on the table, so this can
      -- only be a code collision. Redraw.
      IF v_attempt = 5 THEN
        RAISE;
      END IF;
    END;
  END LOOP;

  INSERT INTO public.group_members (group_id, user_id, role)
  VALUES (v_group.id, v_uid, 'admin');

  RETURN v_group;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- join_group_by_invite_code: resolve the code and join, as 'member', full stop.
--
-- get_group_by_invite_code (20241229000003) stays as it is — the app still
-- wants to name a group before you commit to it — but it is now a lookup only.
-- Holding the code is proved to the database by passing it here, which is the
-- part the old split could never establish: the client resolved the code and
-- then made an unrelated insert, and the DB saw only the insert.
--
-- Statuses rather than exceptions for the two ordinary outcomes. A mistyped
-- code and an already-joined group are things a person did, not faults, and
-- the join field wants to say something specific about each without matching
-- on error strings.
CREATE OR REPLACE FUNCTION public.join_group_by_invite_code(p_code TEXT)
RETURNS JSONB AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_group public.groups%ROWTYPE;
  v_inserted INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Same normalisation as get_group_by_invite_code: codes get pasted out of
  -- share sheets with stray whitespace and arrive in whatever case the
  -- keyboard felt like.
  SELECT * INTO v_group FROM public.groups
  WHERE invite_code = UPPER(TRIM(COALESCE(p_code, '')));

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  INSERT INTO public.group_members (group_id, user_id, role)
  VALUES (v_group.id, v_uid, 'member')
  ON CONFLICT (group_id, user_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN jsonb_build_object(
    'status', CASE WHEN v_inserted > 0 THEN 'joined' ELSE 'already_member' END,
    'group_id', v_group.id,
    'name', v_group.name
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- With both paths server-side, the client never inserts a membership again.
-- No replacement policy: an absent INSERT policy denies every insert, which is
-- exactly the intent. The functions above are SECURITY DEFINER and run as the
-- table owner, so they are unaffected.
DROP POLICY IF EXISTS "Users can join groups (insert own membership)" ON public.group_members;

-- And the same for groups. Leaving this one open while closing the membership
-- side would be worse than either: a client could still insert a group row but
-- could no longer join it, minting exactly the invisible orphan that
-- create_group exists to prevent.
DROP POLICY IF EXISTS "Authenticated users can create groups" ON public.groups;

REVOKE ALL ON FUNCTION public.create_group(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.join_group_by_invite_code(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_group(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_group_by_invite_code(TEXT) TO authenticated;
