-- PLA-49: the group door, rebuilt around one rule.
--
--   Every entry into a group is vouched by a person, and everything a person
--   grants, a person can take back. A named invite is the inviter's vouch. An
--   open link is the group's standing vouch, extended to anyone the circle
--   trusted with it. In approval mode the link stops being a vouch, and an
--   admin's approval becomes one. Every credential that opens the group can be
--   withdrawn, and removing someone withdraws everything they hold.
--
-- What was there before had none of that. groups.invite_code was minted once by
-- create_group and never written again: no expiry, no rotation, no way back.
-- Holding it was the whole proof, so the credential could not be withdrawn from
-- anyone who had ever seen it — and the groups SELECT policy showed it to more
-- people than anyone intended, including the founder forever, via a bare
-- `created_by = auth.uid()` disjunct with no membership test. Kick the founder,
-- and they read the code back off the table and walked in again. That is the
-- bug this issue started as; the rest is the shape of door that makes it a bug.
--
-- Two parts, one migration, because half of either is worse than neither:
--
--   Part 1, the revocable key. The code comes off the table read and moves
--   behind an RPC that requires membership; admins can reset it; removal resets
--   it automatically; and the raw client-side DELETE on group_members closes,
--   so the server can finally tell "left" from "was removed".
--
--   Part 2, the dials. who_can_invite and join_mode, both defaulting to fully
--   open so a friend circle never meets them. In approval mode the bearer link
--   files a request instead of a membership, and an admin's approval is what
--   admits. Named invites bypass approval: a member already vouched.
--
-- Everything below is ordered by dependency, not by part.


-- 1. The two dials ----------------------------------------------------------
--
-- Defaults are WhatsApp's, and deliberately: a group of five that never opens
-- Manage behaves exactly as it did yesterday. The settings exist for the
-- fifty-person padel community, which is a different thing wearing the same
-- shape.

ALTER TABLE public.groups
  ADD COLUMN who_can_invite TEXT NOT NULL DEFAULT 'members'
    CHECK (who_can_invite IN ('members', 'admins')),
  ADD COLUMN join_mode TEXT NOT NULL DEFAULT 'open'
    CHECK (join_mode IN ('open', 'approval'));


-- 2. Requests live in group_invites ------------------------------------------
--
-- A join request is the same object as an invite pointed the other way, so it
-- goes in the same table rather than a new one, and one table stays the door's
-- whole ledger. Two existing mechanisms then work for free:
--
--   * the pending-invitee preview policies (section 3) test `status =
--     'pending'`, so a requester is excluded from the preview without anybody
--     writing a policy for it. They see the group's name through
--     get_group_by_invite_code and nothing else, which is the intent: they have
--     earned nothing more until a person lets them in.
--   * UNIQUE (group_id, invitee_id) means a second knock from the same link is
--     structurally impossible, which is what makes a silent decline final
--     rather than a thing to retry.
--
-- invited_by loses its NOT NULL because a request has no inviter. The CHECK
-- ties the two facts together in both directions, so "a request" and "nobody
-- vouched for this yet" can never drift apart. It reads as a biconditional
-- because it is one: the moment somebody does vouch — a member inviting a
-- declined requester, or an admin approving a live one — the row stops being a
-- request and gains the person who let them in.
ALTER TABLE public.group_invites ALTER COLUMN invited_by DROP NOT NULL;

ALTER TABLE public.group_invites DROP CONSTRAINT group_invites_status_check;
ALTER TABLE public.group_invites ADD CONSTRAINT group_invites_status_check
  CHECK (status IN ('pending', 'accepted', 'ignored', 'requested', 'request_declined'));

ALTER TABLE public.group_invites ADD CONSTRAINT group_invites_request_has_no_inviter
  CHECK ((status IN ('requested', 'request_declined')) = (invited_by IS NULL));

-- The knock and the answer to it. The delivery webhook reads title and body
-- off the row and knows nothing about types, so these two need no work in the
-- Edge Function.
ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'plan_created', 'plan_locked', 'plan_cancelled', 'plan_reopened',
    'plan_promoted', 'invited_to_group', 'kicked_from_group',
    'poll_opened', 'join_requested', 'join_approved'
  ));


-- 3. Only members can see a group --------------------------------------------
--
-- The `created_by = auth.uid()` disjunct goes. 20241229000002_fix_groups_select
-- says in as many words why it was added: back then the client wrote the group
-- row and the creator's membership as two separate inserts, and between them
-- the creator could see neither. create_group (20260731000003) made that one
-- transaction, so the gap it covered has not existed for a while — what was
-- left was a standing permission with no membership test, the same shape PLA-42
-- closed one level up on plans.
--
-- The pending-invitee disjuncts stay exactly as they were. They are what lets
-- the invite card name a group you have not joined, which is the whole reason
-- 20260729000002 exists.

DROP POLICY IF EXISTS "Group members can view their groups" ON public.groups;
CREATE POLICY "Group members can view their groups"
  ON public.groups FOR SELECT
  TO authenticated
  USING (
    public.is_group_member(id)
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


-- 4. And nobody reads the code off the table ---------------------------------
--
-- Membership is now the test for seeing a group, but "can see the group" and
-- "holds the key to it" stopped being the same question the moment the key
-- became revocable. A pending invitee keeps the preview and loses the
-- credential; under the admins dial, so does an ordinary member.
--
-- Column privileges rather than a policy, because the thing to prevent is not
-- only `select('invite_code')`. A filter is a read too: without this,
-- `.eq('invite_code', 'GUESS')` on a table the caller can already see rows in
-- is an oracle you could walk, and no RLS policy would notice. Postgres checks
-- column privileges against every column a statement references, WHERE and
-- ORDER BY included, so the oracle closes with the select.
--
-- The REVOKE has to come first and take the whole table with it: the grant here
-- is table-wide (Supabase's default for public schema), and a column-level
-- REVOKE cannot carve a hole in a table-level GRANT. Same dance as
-- 20260802000002 did for UPDATE on plans, and the same footnote applies — a
-- column added to this table later is unreadable from the client until it is
-- named here. That fails closed, and it will still surprise somebody.
--
-- Three things this looks like it should break and does not:
--
--   * create_group. It returns a groups ROWTYPE from a SECURITY DEFINER
--     function, and a function's result set is not the table; the creator still
--     gets the code back in the row, as an admin of the group they just made.
--   * RLS policies that mention invite_code. Policy expressions are evaluated
--     by the system rather than as part of the caller's column list.
--   * service_role. A separate grantee, untouched, so the integration testbed
--     goes on reading codes to drive its fixtures.
--
-- anon is revoked and not re-granted: no policy on this table admits anon, so
-- the grant was only ever notional.
REVOKE SELECT ON public.groups FROM authenticated, anon;
GRANT SELECT (
  id, name, description, created_by, created_at, updated_at,
  color, anyone_can_post, image_url, who_can_invite, join_mode
) ON public.groups TO authenticated;

-- The one way back to it. Membership always; adminship too when the group has
-- said only admins hand out the way in — gating named invites while any member
-- can still read the link would gate nothing.
CREATE OR REPLACE FUNCTION public.get_group_invite_code(p_group_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_group public.groups%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Membership answers the nonexistent-group case too: group_members.group_id
  -- is a foreign key, so a group that is not there has no members either, and
  -- one message covers both. Deliberately the same message either way — whether
  -- a group exists is not something this function should confirm.
  IF NOT public.is_group_member(p_group_id) THEN
    RAISE EXCEPTION 'Not a member of this group';
  END IF;

  SELECT * INTO v_group FROM public.groups WHERE id = p_group_id;

  IF v_group.who_can_invite = 'admins' AND NOT public.is_group_admin(p_group_id) THEN
    RAISE EXCEPTION 'Only admins can invite to this group';
  END IF;

  RETURN v_group.invite_code;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.get_group_invite_code(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_group_invite_code(UUID) TO authenticated;


-- 5. Minting a fresh code ----------------------------------------------------
--
-- Extracted because two callers need it — rotate_invite_code below and
-- remove_group_member after it — and because the retry is the part worth
-- writing once. create_group draws a code and lets a collision surface as a
-- unique violation it can catch and redraw from; checking for a free code first
-- and then writing it would be the same race with a longer gap in it.
--
-- Not SECURITY DEFINER and granted to nobody. Inside a SECURITY DEFINER caller
-- the effective user is this table's owner, so the callers below reach it and
-- the client cannot.
CREATE OR REPLACE FUNCTION public.mint_invite_code(p_group_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_code TEXT;
  v_attempt INTEGER;
BEGIN
  FOR v_attempt IN 1..5 LOOP
    BEGIN
      UPDATE public.groups
      SET invite_code = public.generate_invite_code(),
          updated_at = NOW()
      WHERE id = p_group_id
      RETURNING invite_code INTO v_code;
      RETURN v_code;
    EXCEPTION WHEN unique_violation THEN
      -- invite_code is the only unique column on groups, so this is a code
      -- collision and nothing else. 32^8 makes five draws plenty.
      IF v_attempt = 5 THEN
        RAISE;
      END IF;
    END;
  END LOOP;
END;
$$ LANGUAGE plpgsql SET search_path = public;

REVOKE ALL ON FUNCTION public.mint_invite_code(UUID) FROM PUBLIC, anon, authenticated;

-- Any admin, matching every other admin power in the product. There is no
-- "founder" tier here and adding one for this would invent a hierarchy the
-- group does not otherwise have.
CREATE OR REPLACE FUNCTION public.rotate_invite_code(p_group_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.is_group_admin(p_group_id) THEN
    RAISE EXCEPTION 'Only admins can reset the invite link';
  END IF;

  RETURN public.mint_invite_code(p_group_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.rotate_invite_code(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rotate_invite_code(UUID) TO authenticated;


-- 6. Removal takes back everything the person held ---------------------------
--
-- The manage screen used to remove people with a raw DELETE on group_members,
-- which is why this exists. That DELETE skipped everything a removal ought to
-- do and, worse, could not be told apart from someone leaving — so the code
-- could not be rotated on one and left alone on the other, which is the whole
-- distinction Part 1 turns on.
--
-- Three things in one transaction:
--
--   * the membership, which the on_group_member_delete trigger (20241229000006)
--     follows as it always has, dropping their RSVPs and availability;
--   * the pending invites they sent, because a vouch is only as good as the
--     person standing behind it and they are no longer in the room;
--   * the code, because they have read it and there is no unreading it.
--
-- Not a ban. After the rotation they cannot let themselves back in, and in
-- approval mode their knock lands on an admin's decline button; any member can
-- still deliberately re-invite them, which is the correct amount of permanence
-- for a group. Keeping a specific person away is what blocking is for.
CREATE OR REPLACE FUNCTION public.remove_group_member(p_group_id UUID, p_user_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.is_group_admin(p_group_id) THEN
    RAISE EXCEPTION 'Only admins can remove members';
  END IF;

  -- Leaving is leave_group, and the difference matters: it promotes an heir,
  -- deletes the group when the last person goes, and does not rotate the code.
  -- Routing self-removal through here would silently skip all three.
  IF p_user_id = v_uid THEN
    RAISE EXCEPTION 'Use leave_group to leave a group';
  END IF;

  DELETE FROM public.group_members
  WHERE group_id = p_group_id AND user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_a_member');
  END IF;

  DELETE FROM public.group_invites
  WHERE group_id = p_group_id AND invited_by = p_user_id AND status = 'pending';

  PERFORM public.mint_invite_code(p_group_id);

  RETURN jsonb_build_object('status', 'removed');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.remove_group_member(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_group_member(UUID, UUID) TO authenticated;

-- And with both exits server-side, the open one closes — the same move PLA-35
-- made on the INSERT side. No replacement policy: an absent DELETE policy
-- denies every delete, which is the intent. leave_group and
-- remove_group_member are SECURITY DEFINER and run as the table's owner, so
-- heir promotion, empty-group cleanup and the code rotation stop being
-- skippable by anyone. Every membership row now enters and exits through a
-- function that decides what else must happen.
DROP POLICY IF EXISTS "Members can leave or admins can kick" ON public.group_members;


-- 7. The door itself ---------------------------------------------------------
--
-- join_group_by_invite_code becomes the whole decision. The matrix it answers,
-- which is also the matrix the integration tests walk:
--
--                        | open              | approval
--   ---------------------+-------------------+---------------------------
--   member already       | already_member    | already_member
--   pending invitee      | joined            | joined  (see below)
--   live requester       | joined            | requested, nothing filed
--   declined requester   | joined            | requested, nothing filed
--   anyone else          | joined            | requested, admins notified
--   removed member       | not_found (the code they hold is dead either way)
--
-- The one cell worth arguing about is the pending invitee in approval mode. A
-- named invite is a member's vouch, and approval exists to gate the bearer
-- link, not to make a member's word insufficient — so their invite walks them
-- straight in and is marked spent on the way. That is the same reason
-- respond_group_invite is untouched by this migration: it only ever sees
-- pending rows, and a pending row is already vouched.
--
-- No block guards here, deliberately and unchanged: blocks never police what
-- belongs to the group. Two people who have blocked each other can be in the
-- same group, and the shield decides what they see of each other inside it.
CREATE OR REPLACE FUNCTION public.join_group_by_invite_code(p_code TEXT)
RETURNS JSONB AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_group public.groups%ROWTYPE;
  v_invite public.group_invites%ROWTYPE;
  -- Held in a variable rather than read off FOUND, which the INSERT further
  -- down would overwrite before the last test that needs this answer.
  v_has_invite BOOLEAN;
  v_name TEXT;
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

  IF public.is_group_member(v_group.id) THEN
    RETURN jsonb_build_object(
      'status', 'already_member', 'group_id', v_group.id, 'name', v_group.name
    );
  END IF;

  SELECT * INTO v_invite FROM public.group_invites
  WHERE group_id = v_group.id AND invitee_id = v_uid FOR UPDATE;
  v_has_invite := FOUND;

  -- Approval mode, and no member has vouched for this person: file the knock
  -- and stop. A row that is already a request — live or declined — is left
  -- exactly as it is. Nothing is written, nothing is sent, and the answer is
  -- the same 'requested' either way, so a decline stays silent and the same
  -- link never files twice. Someone who wants back in needs a member to invite
  -- them, which is a person's vouch superseding the group's silence.
  IF v_group.join_mode = 'approval' AND COALESCE(v_invite.status, '') <> 'pending' THEN
    IF v_has_invite AND v_invite.status IN ('requested', 'request_declined') THEN
      RETURN jsonb_build_object(
        'status', 'requested', 'group_id', v_group.id, 'name', v_group.name
      );
    END IF;

    -- A settled row from an older life here (they accepted once and left, or
    -- ignored an invite) becomes the request, because UNIQUE (group_id,
    -- invitee_id) means there is one row per person per group and this is it.
    IF v_has_invite THEN
      UPDATE public.group_invites
      SET status = 'requested', invited_by = NULL, created_at = NOW(), responded_at = NULL
      WHERE id = v_invite.id;
    ELSE
      INSERT INTO public.group_invites (group_id, invited_by, invitee_id, status)
      VALUES (v_group.id, NULL, v_uid, 'requested');
    END IF;

    SELECT display_name INTO v_name FROM public.profiles WHERE id = v_uid;

    -- Admins only: a knock is an admin's decision and fanning it to fifty
    -- people would make approval worse than no door at all. An admin this
    -- person has blocked is skipped, same direction as every other fan-out
    -- since PLA-44 — the blocked stop seeing what the blocker creates, and a
    -- knock is something they created. If they have blocked every admin, the
    -- knock sits unanswered, which is the silence the shield prescribes.
    INSERT INTO public.notifications (user_id, type, title, body, data)
    SELECT gm.user_id, 'join_requested', 'Someone wants in',
           format('%s asked to join %s.', COALESCE(v_name, 'Someone'), v_group.name),
           jsonb_build_object('group_id', v_group.id, 'user_id', v_uid)
    FROM public.group_members gm
    WHERE gm.group_id = v_group.id
      AND gm.role = 'admin'
      AND NOT EXISTS (
        SELECT 1 FROM public.blocked_users b
        WHERE b.blocker_id = v_uid AND b.blocked_id = gm.user_id
      );

    RETURN jsonb_build_object(
      'status', 'requested', 'group_id', v_group.id, 'name', v_group.name
    );
  END IF;

  INSERT INTO public.group_members (group_id, user_id, role)
  VALUES (v_group.id, v_uid, 'member');

  -- A named invite they were holding is spent, whichever mode admitted them.
  -- Left pending it would go on offering them an invite to a group they are
  -- standing in.
  IF v_has_invite AND v_invite.status = 'pending' THEN
    UPDATE public.group_invites
    SET status = 'accepted', responded_at = NOW()
    WHERE id = v_invite.id;
  END IF;

  RETURN jsonb_build_object('status', 'joined', 'group_id', v_group.id, 'name', v_group.name);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- 8. The doorman's answer ----------------------------------------------------
--
-- Approving sets invited_by to the admin who did it, which is the CHECK in
-- section 2 doing its job: the row stops being a request at the exact moment
-- somebody vouches, and it records who. Declining leaves invited_by null and
-- sends nothing — the requester's screen goes on saying the request was sent,
-- and the same link never files another. Success-shaped silence is what a
-- block already does, and here it is also what stops knock spam.
CREATE OR REPLACE FUNCTION public.respond_to_join_request(
  p_group_id UUID,
  p_user_id UUID,
  p_approve BOOLEAN
)
RETURNS JSONB AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_invite public.group_invites%ROWTYPE;
  v_group_name TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.is_group_admin(p_group_id) THEN
    RAISE EXCEPTION 'Only admins can answer join requests';
  END IF;

  SELECT * INTO v_invite FROM public.group_invites
  WHERE group_id = p_group_id AND invitee_id = p_user_id FOR UPDATE;

  -- Two admins reaching for the same knock, or a request that a member turned
  -- into a real invite while this screen was open. Neither is an error worth
  -- raising at somebody.
  IF NOT FOUND OR v_invite.status <> 'requested' THEN
    RETURN jsonb_build_object('status', 'already_handled');
  END IF;

  IF NOT p_approve THEN
    UPDATE public.group_invites
    SET status = 'request_declined', responded_at = NOW()
    WHERE id = v_invite.id;
    RETURN jsonb_build_object('status', 'declined');
  END IF;

  UPDATE public.group_invites
  SET status = 'accepted', invited_by = v_uid, responded_at = NOW()
  WHERE id = v_invite.id;

  INSERT INTO public.group_members (group_id, user_id, role)
  VALUES (p_group_id, p_user_id, 'member')
  ON CONFLICT (group_id, user_id) DO NOTHING;

  SELECT name INTO v_group_name FROM public.groups WHERE id = p_group_id;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    p_user_id, 'join_approved', 'You are in',
    format('You have been let into %s.', v_group_name),
    jsonb_build_object('group_id', p_group_id)
  );

  RETURN jsonb_build_object('status', 'approved');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.respond_to_join_request(UUID, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_join_request(UUID, UUID, BOOLEAN) TO authenticated;


-- 9. Named invites under the admins dial -------------------------------------
--
-- Re-emitted whole from 20260804000002, where the block guards live; the only
-- addition is the who_can_invite gate. Merged migrations are immutable, so this
-- is the convention for changing one — copy the latest definition, edit the one
-- thing, and say what the one thing was.
--
-- The fallthrough at the bottom is doing more work than it used to and is
-- deliberately left alone to do it: a row sitting at request_declined or
-- requested becomes a real pending invite with the inviting member's name on
-- it. A person's vouch supersedes the group's silence, and that is the escape
-- hatch that lets a silent decline be final without being permanent.
CREATE OR REPLACE FUNCTION public.invite_to_group(p_group_id UUID, p_invitee UUID)
RETURNS JSONB AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_row public.group_invites%ROWTYPE;
  v_who_can_invite TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_group_member(p_group_id) THEN
    RAISE EXCEPTION 'Only members can invite';
  END IF;

  SELECT who_can_invite INTO v_who_can_invite FROM public.groups WHERE id = p_group_id;
  IF v_who_can_invite = 'admins' AND NOT public.is_group_admin(p_group_id) THEN
    RAISE EXCEPTION 'Only admins can invite to this group';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = p_group_id AND user_id = p_invitee
  ) THEN
    RETURN jsonb_build_object('status', 'already_member');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.blocked_users
    WHERE blocker_id = v_uid AND blocked_id = p_invitee
  ) THEN
    RETURN jsonb_build_object('status', 'you_blocked_them');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.blocked_users
    WHERE blocker_id = p_invitee AND blocked_id = v_uid
  ) THEN
    RETURN jsonb_build_object('status', 'invited');
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


-- 10. Who can see a knock, and who can withdraw a vouch ----------------------
--
-- SELECT. Three disjuncts where there were two, because a request is not an
-- invite and must not be visible to the group at large:
--
--   * your own row, always, request or invite. It is the one thing a requester
--     can read about their own knock.
--   * request rows to admins, minus any admin the requester has blocked. That
--     is the shield rule landing on this table: an admin they blocked does not
--     see the knock and is skipped by its push, and if they blocked every admin
--     the knock is simply never answered. An admin who blocked *them* keeps
--     seeing it and can decline or approve, because a blocker keeps seeing the
--     blocked exactly as before.
--   * everything else to members, which is what the invite sheet reads to grey
--     out the friends it has already invited.
--
-- DELETE. The inviter disjunct gains a membership test. A removed member could
-- still withdraw invites they sent while they were in the group; nothing but an
-- accidental side effect of the old SELECT policy was stopping them, and
-- section 6 now deletes their pending invites on the way out anyway. This makes
-- it a rule rather than a consequence.

DROP POLICY IF EXISTS "Invitee and group members can view invites" ON public.group_invites;
CREATE POLICY "Invitee and group members can view invites"
  ON public.group_invites FOR SELECT
  TO authenticated
  USING (
    invitee_id = auth.uid()
    OR (
      status IN ('requested', 'request_declined')
      AND public.is_group_admin(group_id)
      AND NOT public.is_blocked_by(invitee_id)
    )
    OR (
      status NOT IN ('requested', 'request_declined')
      AND public.is_group_member(group_id)
    )
  );

DROP POLICY IF EXISTS "Inviter or admins can withdraw invites" ON public.group_invites;
CREATE POLICY "Inviter or admins can withdraw invites"
  ON public.group_invites FOR DELETE
  TO authenticated
  USING (
    (invited_by = auth.uid() AND public.is_group_member(group_id))
    OR public.is_group_admin(group_id)
  );


-- 11. Setting the dials ------------------------------------------------------
--
-- The groups UPDATE policy is already admin-only, so this closes no hole. It
-- exists because every other door mutation is a SECURITY DEFINER function and a
-- settings write that is not would be the odd one out — and because two
-- independent switches on one row want to be settable independently. Both
-- arguments default to null and only what is passed is written, so flipping one
-- toggle cannot carry a stale copy of the other back over it.
--
-- Turning approval off admits nobody. Pending requests stay exactly as they
-- are, because a mode is a rule about the door and not a decision about the
-- people standing at it; the admin who wants them in has Approve.
CREATE OR REPLACE FUNCTION public.update_group_door(
  p_group_id UUID,
  p_who_can_invite TEXT DEFAULT NULL,
  p_join_mode TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_group public.groups%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.is_group_admin(p_group_id) THEN
    RAISE EXCEPTION 'Only admins can change these settings';
  END IF;

  -- The column CHECKs in section 1 are what actually hold these two values to
  -- their vocabulary, for every writer including a future one that skips this
  -- function. These two tests only buy a sentence a person can read instead of
  -- a constraint-violation dump, so if a third value is ever added it is added
  -- to the CHECK first and these follow.
  IF p_who_can_invite IS NOT NULL AND p_who_can_invite NOT IN ('members', 'admins') THEN
    RAISE EXCEPTION 'who_can_invite must be members or admins';
  END IF;

  IF p_join_mode IS NOT NULL AND p_join_mode NOT IN ('open', 'approval') THEN
    RAISE EXCEPTION 'join_mode must be open or approval';
  END IF;

  UPDATE public.groups
  SET who_can_invite = COALESCE(p_who_can_invite, who_can_invite),
      join_mode = COALESCE(p_join_mode, join_mode),
      updated_at = NOW()
  WHERE id = p_group_id
  RETURNING * INTO v_group;

  RETURN jsonb_build_object(
    'who_can_invite', v_group.who_can_invite,
    'join_mode', v_group.join_mode
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.update_group_door(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_group_door(UUID, TEXT, TEXT) TO authenticated;


-- 12. The preview, told what kind of door it is ------------------------------
--
-- The join screen has to say what the button will do before the button is
-- pressed: "Join the padel lot" and "Ask to join the padel lot" are different
-- promises, and finding out which one it was by pressing it is the shape of
-- this whole issue in miniature. So the preview returns join_mode alongside the
-- name. Dropped and recreated rather than replaced because the return type
-- changes, which also means re-issuing the grant.
--
-- Two things fixed while here, both pre-dating this issue: the function had no
-- `SET search_path`, and its EXECUTE was never revoked from PUBLIC, so anon
-- could walk codes against it without an account. It still returns nothing but
-- a name — the roster, the colour and the code stay behind membership — and now
-- it wants a session first.
DROP FUNCTION public.get_group_by_invite_code(TEXT);
CREATE OR REPLACE FUNCTION public.get_group_by_invite_code(code TEXT)
RETURNS TABLE (id UUID, name TEXT, join_mode TEXT) AS $$
  SELECT g.id, g.name, g.join_mode
  FROM public.groups g
  WHERE g.invite_code = UPPER(TRIM(COALESCE(code, '')));
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.get_group_by_invite_code(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_group_by_invite_code(TEXT) TO authenticated;
