-- PLA-42: created_by was a standing permission.
--
-- Removing someone from a group did almost everything right. The membership
-- row goes, on_group_member_delete (20241229000006) clears their RSVPs and
-- date availability, and RLS stops them reading the group at all. What it
-- never touched is plans.created_by, and every plan action authorised like
-- this:
--
--   (v_plan.created_by = v_uid) OR EXISTS (… role = 'admin')
--
-- "Did you make this?" with no "and are you still here?". So the first half
-- stayed true forever.
--
-- The four lifecycle RPCs are SECURITY DEFINER, which is the whole problem:
-- they run as the table owner, RLS never executes inside them, and none of
-- them needs to read the plan through a policy to act on it. A removed person
-- keeps a valid JWT until it expires and refreshes fine afterwards, and the
-- call takes nothing but the plan's UUID — which they already have from a push
-- notification, a deep link, a cached query or a screenshot. They cannot open
-- the plan, and they can still cancel it.
--
-- That matters because removal is the tool for getting a bad actor out of a
-- group, and the person just removed is the one most likely to want to lash
-- out. leave_group had the identical hole, and leaving is far more common.
--
-- created_by stays where it is. The plan keeps an accurate record of who set it
-- up, the group goes on seeing it, and a group admin can always act on it —
-- there is always at least one, since a removal is performed by an admin and
-- leave_group promotes an heir when the last one goes. Nulling it out, the way
-- delete_my_account (20260801000000) does, would buy nothing here and would
-- rewrite history that is still true.


-- 1. The test itself ---------------------------------------------------------
--
-- One membership lookup answers both halves at once: you must have a row in
-- this group, and in it be either an admin or the plan's creator. Admin already
-- implies membership, so the shape collapses to a single EXISTS rather than the
-- two the old inline check needed.
--
-- SECURITY DEFINER for the same reason is_group_member has it (20241229000001):
-- group_members carries its own RLS, and reading it from inside a policy on
-- another table would recurse.
--
-- A plan whose creator deleted their account has created_by IS NULL, so
-- `gm.user_id = p_created_by` is NULL, the OR reduces to the admin branch, and
-- an orphaned plan is exactly as manageable as it was before. Fails closed.
CREATE OR REPLACE FUNCTION public.is_plan_host(p_group_id UUID, p_created_by UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_members gm
    WHERE gm.group_id = p_group_id
      AND gm.user_id = auth.uid()
      AND (gm.role = 'admin' OR gm.user_id = p_created_by)
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

REVOKE ALL ON FUNCTION public.is_plan_host(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_plan_host(UUID, UUID) TO authenticated;


-- 2. The four RPCs -----------------------------------------------------------
--
-- Postgres has no way to amend a function's authorisation in place, so each one
-- is re-emitted whole. The bodies below are copied verbatim from their current
-- definitions — lock_plan, cancel_plan and restore_plan from 20260802000005,
-- reopen_plan from 20260728000001, which nothing has touched since. The only
-- edit in each is the v_authorized block giving way to a single is_plan_host
-- call, and the now-unused declaration going with it.
--
-- The exception strings are left exactly as they were. They are what a plain
-- member sees if they ever reach one of these, and "creator or group admin" is
-- still the useful thing to tell them; nobody in the removed case is reading
-- error copy, because nobody in the removed case can open the screen.


CREATE OR REPLACE FUNCTION public.lock_plan(
  p_plan_id UUID,
  p_date_option_id UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_plan public.plans%ROWTYPE;
  v_yes_count INTEGER;
  v_option RECORD;
  v_notified INTEGER := 0;
  v_held INTEGER;
  v_limit INTEGER;
  v_base INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_plan FROM public.plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan not found';
  END IF;

  IF NOT public.is_plan_host(v_plan.group_id, v_plan.created_by) THEN
    RAISE EXCEPTION 'Only the plan creator or a group admin can lock a plan';
  END IF;

  IF v_plan.status <> 'open' THEN
    RAISE EXCEPTION 'Plan is not open';
  END IF;

  IF v_plan.plan_type = 'fixed' THEN
    SELECT COUNT(*) INTO v_yes_count
    FROM public.rsvps
    WHERE plan_id = p_plan_id AND response = 'yes';

    IF v_yes_count < v_plan.min_people THEN
      RETURN jsonb_build_object('locked', false, 'reason', 'below_minimum');
    END IF;

    UPDATE public.plans
    SET status = 'locked', locked_at = NOW(), updated_at = NOW()
    WHERE id = p_plan_id;

    INSERT INTO public.notifications (user_id, type, title, body, data)
    SELECT r.user_id, 'plan_locked', 'Plan Confirmed!',
           format('"%s" is happening!', v_plan.title),
           jsonb_build_object('plan_id', p_plan_id, 'group_id', v_plan.group_id)
    FROM public.rsvps r
    WHERE r.plan_id = p_plan_id AND r.response = 'yes'
      AND NOT EXISTS (
        SELECT 1 FROM public.blocked_users b
        WHERE b.blocker_id = r.user_id
          AND b.blocked_id = v_plan.created_by
      );
    GET DIAGNOSTICS v_notified = ROW_COUNT;

    RETURN jsonb_build_object('locked', true, 'notified', v_notified);
  END IF;

  SELECT o.id, o.date, COUNT(da.id) AS cnt
  INTO v_option
  FROM public.plan_date_options o
  LEFT JOIN public.date_availability da
    ON da.date_option_id = o.id AND da.available
  WHERE o.plan_id = p_plan_id
    AND (p_date_option_id IS NULL OR o.id = p_date_option_id)
  GROUP BY o.id, o.date
  HAVING COUNT(da.id) >= v_plan.min_people
  ORDER BY COUNT(da.id) DESC, o.date ASC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('locked', false, 'reason', 'no_viable_date');
  END IF;

  UPDATE public.plans
  SET status = 'locked', locked_date = v_option.date, locked_at = NOW(), updated_at = NOW()
  WHERE id = p_plan_id;

  -- EVERY existing yes is a seat already spent, whether or not that person is
  -- free on the date being locked.
  --
  -- Discounting only the unavailable holders is not enough, and this is the
  -- re-lock bug: reopen_plan leaves the yes rows in place, so locking again
  -- onto a different date meets holders who ARE available but sort outside
  -- the new top-N. They hold a seat nobody counted, the newcomer chosen in
  -- their place trips the trigger, and the exception rolls back the lock the
  -- host just asked for, leaving the plan open with no explanation.
  SELECT COUNT(*) INTO v_held
  FROM public.rsvps
  WHERE plan_id = p_plan_id AND response = 'yes';

  -- NULL is "No limit", so an uncapped plan seats everyone and waitlists
  -- nobody, exactly as it did before this migration.
  v_limit := CASE
    WHEN v_plan.max_people IS NULL THEN NULL
    ELSE GREATEST(v_plan.max_people - v_held, 0)
  END;

  -- Where this lock's queue numbers start. Normally zero. Non-zero only on a
  -- re-lock of a plan that already had people waiting, whose places are kept.
  SELECT COALESCE(MAX(waitlist_seq), 0) INTO v_base
  FROM public.rsvps
  WHERE plan_id = p_plan_id AND response = 'pending';

  -- Availability on the locked date becomes attendance up to whatever the cap
  -- has left, and a place in the queue after that. Anyone already holding a
  -- yes is excluded rather than re-seated: they are counted in v_held, their
  -- row already says yes, and re-inserting them would only re-notify them on
  -- every re-lock. Anyone who has blocked the plan's creator is excluded from
  -- both lists, for the reason 20260802000001 gives.
  --
  -- rn ranks the whole field once, in the same first-come order the cap
  -- doctrine has used since 20260731000001, and the two sets read off it. So
  -- seating and queueing cannot disagree about who was ahead of whom, and the
  -- queue is the continuation of the seating rather than a second opinion.
  --
  -- Every data-modifying CTE runs exactly once and to completion whether or
  -- not the primary query reads it, which is why waiting_rsvps needs no
  -- consumer.
  WITH ranked AS (
    SELECT da.user_id,
           row_number() OVER (ORDER BY da.created_at ASC, da.user_id ASC) AS rn
    FROM public.date_availability da
    WHERE da.date_option_id = v_option.id
      AND da.available
      AND NOT EXISTS (
        SELECT 1 FROM public.rsvps r
        WHERE r.plan_id = p_plan_id
          AND r.user_id = da.user_id
          AND r.response = 'yes'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.blocked_users b
        WHERE b.blocker_id = da.user_id
          AND b.blocked_id = v_plan.created_by
      )
  ),
  seated AS (
    SELECT user_id, rn FROM ranked
    WHERE v_limit IS NULL OR rn <= v_limit
  ),
  waiting AS (
    SELECT user_id, rn FROM ranked
    WHERE v_limit IS NOT NULL AND rn > v_limit
  ),
  seated_rsvps AS (
    INSERT INTO public.rsvps (plan_id, user_id, response)
    SELECT p_plan_id, s.user_id, 'yes' FROM seated s
    ON CONFLICT (plan_id, user_id) DO UPDATE SET response = 'yes'
    RETURNING user_id
  ),
  waiting_rsvps AS (
    INSERT INTO public.rsvps (plan_id, user_id, response, waitlist_seq)
    SELECT p_plan_id, w.user_id, 'pending', v_base + w.rn FROM waiting w
    -- COALESCE, not EXCLUDED: somebody already waiting keeps the place they
    -- have. A re-lock re-decides who is in, never who has been waiting longer.
    ON CONFLICT (plan_id, user_id) DO UPDATE
      SET response = 'pending',
          waitlist_seq = COALESCE(public.rsvps.waitlist_seq, EXCLUDED.waitlist_seq)
    RETURNING user_id
  )
  -- Only the people who actually got a seat are told the plan is happening.
  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT s.user_id, 'plan_locked', 'Plan Confirmed!',
         format('"%s" is happening on %s!', v_plan.title, to_char(v_option.date, 'FMDay DD Mon')),
         jsonb_build_object('plan_id', p_plan_id, 'group_id', v_plan.group_id)
  FROM seated s;
  GET DIAGNOSTICS v_notified = ROW_COUNT;

  RETURN jsonb_build_object(
    'locked', true,
    'locked_date', v_option.date,
    'notified', v_notified
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


CREATE OR REPLACE FUNCTION public.cancel_plan(p_plan_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_plan public.plans%ROWTYPE;
  v_notified INTEGER := 0;
  v_reason TEXT := NULLIF(TRIM(p_reason), '');
  v_name TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_plan FROM public.plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan not found';
  END IF;

  IF NOT public.is_plan_host(v_plan.group_id, v_plan.created_by) THEN
    RAISE EXCEPTION 'Only the plan creator or a group admin can cancel a plan';
  END IF;

  IF v_plan.status = 'cancelled' THEN
    RETURN jsonb_build_object('cancelled', true, 'already_cancelled', true);
  END IF;

  UPDATE public.plans
  SET status = 'cancelled',
      cancelled_at = NOW(),
      cancelled_by = v_uid,
      cancel_reason = v_reason,
      updated_at = NOW()
  WHERE id = p_plan_id;

  SELECT display_name INTO v_name FROM public.profiles WHERE id = v_uid;

  -- Everyone who said yes or is waiting (fixed) or marked availability
  -- (flexible), except whoever is cancelling and anyone who blocked the
  -- creator.
  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT DISTINCT u.user_id, 'plan_cancelled', 'Called off',
         CASE
           WHEN v_reason IS NOT NULL THEN
             format('%s called off "%s": "%s"', v_name, v_plan.title, v_reason)
           ELSE
             format('%s called off "%s".', v_name, v_plan.title)
         END,
         jsonb_build_object('plan_id', p_plan_id, 'group_id', v_plan.group_id)
  FROM (
    SELECT r.user_id FROM public.rsvps r
    WHERE r.plan_id = p_plan_id AND r.response IN ('yes', 'pending')
    UNION
    SELECT da.user_id FROM public.date_availability da
    WHERE da.plan_id = p_plan_id AND da.available
  ) u
  WHERE u.user_id <> v_uid
    AND NOT EXISTS (
      SELECT 1 FROM public.blocked_users b
      WHERE b.blocker_id = u.user_id
        AND b.blocked_id = v_plan.created_by
    );
  GET DIAGNOSTICS v_notified = ROW_COUNT;

  RETURN jsonb_build_object('cancelled', true, 'notified', v_notified);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


CREATE OR REPLACE FUNCTION public.restore_plan(p_plan_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_plan public.plans%ROWTYPE;
  v_date TIMESTAMPTZ;
  v_status TEXT;
  v_notified INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_plan FROM public.plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan not found';
  END IF;

  IF NOT public.is_plan_host(v_plan.group_id, v_plan.created_by) THEN
    RAISE EXCEPTION 'Only the plan creator or a group admin can restore a plan';
  END IF;

  IF v_plan.status <> 'cancelled' THEN
    RAISE EXCEPTION 'Plan is not cancelled';
  END IF;

  SELECT COALESCE(v_plan.locked_date, v_plan.event_date, MAX(o.date))
  INTO v_date
  FROM public.plan_date_options o
  WHERE o.plan_id = p_plan_id;

  -- The client hides Reopen after the end of the plan's day (local time);
  -- the 1-day grace keeps the server check from disagreeing across zones.
  IF v_date IS NOT NULL AND v_date < NOW() - INTERVAL '1 day' THEN
    RAISE EXCEPTION 'The date has passed';
  END IF;

  -- A flexible plan that had locked a date goes back to locked; everything
  -- else (fixed plans, open votes) returns to open.
  v_status := CASE
    WHEN v_plan.plan_type = 'flexible' AND v_plan.locked_at IS NOT NULL THEN 'locked'
    ELSE 'open'
  END;

  UPDATE public.plans
  SET status = v_status,
      cancelled_at = NULL,
      cancelled_by = NULL,
      cancel_reason = NULL,
      updated_at = NOW()
  WHERE id = p_plan_id;

  -- The waiting test is an EXISTS rather than a column on the union, because
  -- the union deduplicates on the whole row: a flag that differed between the
  -- two branches would give the same person two notifications.
  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT DISTINCT u.user_id, 'plan_reopened', 'Back on',
         CASE
           WHEN EXISTS (
             SELECT 1 FROM public.rsvps r2
             WHERE r2.plan_id = p_plan_id
               AND r2.user_id = u.user_id
               AND r2.response = 'pending'
           ) THEN
             format('"%s" is back on. You''re still on the waiting list.', v_plan.title)
           WHEN v_status = 'locked' OR v_plan.plan_type = 'fixed' THEN
             format('"%s" is back on. You''re still counted in.', v_plan.title)
           ELSE
             format('"%s" is back on. Your dates still stand.', v_plan.title)
         END,
         jsonb_build_object('plan_id', p_plan_id, 'group_id', v_plan.group_id)
  FROM (
    SELECT r.user_id FROM public.rsvps r
    WHERE r.plan_id = p_plan_id AND r.response IN ('yes', 'pending')
    UNION
    SELECT da.user_id FROM public.date_availability da
    WHERE da.plan_id = p_plan_id AND da.available
  ) u
  WHERE u.user_id <> v_uid
    AND NOT EXISTS (
      SELECT 1 FROM public.blocked_users b
      WHERE b.blocker_id = u.user_id
        AND b.blocked_id = v_plan.created_by
    );
  GET DIAGNOSTICS v_notified = ROW_COUNT;

  RETURN jsonb_build_object('restored', true, 'status', v_status, 'notified', v_notified);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


CREATE OR REPLACE FUNCTION public.reopen_plan(p_plan_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_plan public.plans%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_plan FROM public.plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan not found';
  END IF;

  IF NOT public.is_plan_host(v_plan.group_id, v_plan.created_by) THEN
    RAISE EXCEPTION 'Only the plan creator or a group admin can reopen a plan';
  END IF;

  IF v_plan.status <> 'locked' THEN
    RAISE EXCEPTION 'Plan is not locked';
  END IF;
  IF v_plan.plan_type <> 'flexible' THEN
    RAISE EXCEPTION 'Only flexible plans can reopen the vote';
  END IF;

  UPDATE public.plans
  SET status = 'open', locked_date = NULL, locked_at = NULL, updated_at = NOW()
  WHERE id = p_plan_id;

  RETURN jsonb_build_object('reopened', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- No grants are re-issued above. CREATE OR REPLACE FUNCTION keeps the existing
-- ACL, and all four already carry exactly these grants from the migrations that
-- introduced them; 20260802000005 re-emits three of the same functions and
-- re-grants nothing. Restating them here would read as if this migration were
-- changing privileges, in a migration whose subject is privileges.


-- 3. The same test on the two write policies that mention created_by ---------
--
-- These two are hardening, not live bugs, and it is worth being exact about
-- why — the difference is the whole reason section 2 above exists.
--
-- A removed member cannot reach either of them today, but not because the
-- policies say so. Postgres applies SELECT policies to the rows an UPDATE or
-- DELETE names in its WHERE clause, and PostgREST omits RETURNING when the
-- client does not ask for the row back, so `PATCH /plans?id=eq.X` with no
-- `select` is still filtered by "Group members can view plans" before the
-- UPDATE policy is ever consulted. The date-options policy is covered by the
-- same accident: its WITH CHECK subquery reads public.plans, and that read
-- obeys RLS too.
--
-- Which is to say the protection is entirely a side effect of a removed person
-- being unable to SELECT the plan. That held here and did not hold for the
-- RPCs, because SECURITY DEFINER switches RLS off — one seam away, the same
-- authorisation bug was live. Leaving it resting on the SELECT policy means any
-- future widening of that policy inherits a write hole silently, and
-- 20260729000002 widened exactly that kind of policy once already, so invitees
-- could preview a group they had not joined.
--
-- Scope, so the next reader is not misled about what this bought: only these
-- two policies name created_by, and only these two are changed. The write
-- policies on rsvps (20260731000000) and date_availability (20241229000000)
-- derive membership through the same plans-subquery accident, and they are NOT
-- hardened here — they authorise on `user_id = auth.uid()`, so the worst a
-- removed member could do is edit their own already-deleted rows. They are
-- listed because "which policies are load-bearing" should not have to be
-- rediscovered.
DROP POLICY IF EXISTS "Host can edit a live plan" ON public.plans;

CREATE POLICY "Host can edit a live plan"
  ON public.plans FOR UPDATE
  TO authenticated
  USING (
    public.is_plan_host(group_id, created_by)
    AND status <> 'cancelled'
  );

-- Unchanged in who it admits — the plan's creator, not admins — and the column
-- grants from 20260802000002 still bound it to title/location/description.
DROP POLICY IF EXISTS "Plan creators can insert date options" ON public.plan_date_options;

CREATE POLICY "Plan creators can insert date options"
  ON public.plan_date_options FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.plans p
      WHERE p.id = plan_date_options.plan_id
        AND p.created_by = auth.uid()
        AND public.is_group_member(p.group_id)
    )
  );


-- 4. Deleting a plan is not a thing the client does --------------------------
--
-- No screen in the app deletes a plan and no integration test deletes one as an
-- authenticated user. Ending a plan means cancel_plan, which stamps who and why
-- and tells everyone who was in; a hard DELETE is that same act with nobody
-- told and no record left. The privilege only ever existed because Supabase
-- grants the full set on every table in public by default.
--
-- So it goes, the way 20260802000002 removed client UPDATE for the same reason
-- rather than narrowing it. A row-level guard here would still leave a current
-- member-creator able to make a plan disappear from under everyone who had
-- said yes.
--
-- service_role is a separate grantee and is untouched: the integration
-- testbed's teardown and the account-deletion path keep working. If a delete
-- ever becomes a product feature, it arrives as a SECURITY DEFINER RPC that can
-- notify, like every other ending.
DROP POLICY IF EXISTS "Creator and admins can delete plans" ON public.plans;
REVOKE DELETE ON public.plans FROM authenticated, anon;
