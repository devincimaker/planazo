-- PLA-44: blocking, rebuilt around the shield rule.
--
-- The rule, which AGENTS.md now carries: a block erases you from the blocked
-- person's life, not them from yours. The person you block stops seeing what
-- you create, cannot find or contact you, and no longer attends your plans.
-- You keep seeing them exactly as before. A block is never announced. It
-- never touches what belongs to the group, and unblocking restores sight but
-- never what it dissolved.
--
-- This REVERSES what 20260802000000 built. The old block was a personal mute:
-- has_blocked() hid *their* plans from *you*, and every notification fan-out
-- skipped recipients who had blocked the creator. Muting yourself out of the
-- group's life is a tool someone might want, but it is not what anyone means
-- by "block" — every platform that has both (Instagram, Facebook, Discord,
-- Luma) points the block the other way, at the blocked person's sight of the
-- blocker. So every filter here flips direction, and the two things a mute
-- never did — unfriending, and pulling the blocked person out of your
-- upcoming plans — start happening.
--
-- One row is one arrow. Symmetry is not imposed: if both people block each
-- other, two rows exist and each unblock undoes only its own side.
--
-- The invariant every visibility decision below preserves: if you can see a
-- plan, you see its full list and its real count. Counts are never doctored
-- per viewer; they change only when someone really joins or withdraws.
-- Member lists are deliberately untouched too — the member row is where the
-- Block button lives, which is what guarantees the blocked person can always
-- block back.


-- 1. The mirror of has_blocked ----------------------------------------------
--
-- "Has p_other blocked me?" — the question every SELECT policy now asks about
-- a row's author. SECURITY DEFINER for the same reason has_blocked was: the
-- blocked_users SELECT policy only shows the blocker their own rows, and this
-- must read the other side's row without re-entering that RLS. The answer
-- never reaches the client as data; it only makes rows vanish, which is
-- indistinguishable from the row never having existed.
--
-- The IS NOT NULL guard keeps orphaned plans (created_by nulled by
-- delete_my_account) visible to everyone, exactly as has_blocked did.
CREATE OR REPLACE FUNCTION public.is_blocked_by(p_other UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_other IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.blocked_users
    WHERE blocker_id = p_other AND blocked_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_blocked_by(UUID) FROM public;
GRANT EXECUTE ON FUNCTION public.is_blocked_by(UUID) TO authenticated;


-- 2. Sight ------------------------------------------------------------------
--
-- The two SELECT policies that carried has_blocked, flipped. Blocking someone
-- no longer hides their plans from you — you keep seeing them exactly as
-- before, so blocking never costs you the group's life (the person you block
-- may be the one hosting the circle's dinner). What changes is their side:
-- your plans and your photos stop existing for them, in the feed, in the
-- group, and by direct link alike, because it is the row that disappears.

DROP POLICY IF EXISTS "Group members can view plans" ON public.plans;
CREATE POLICY "Group members can view plans"
  ON public.plans FOR SELECT
  TO authenticated
  USING (
    public.is_group_member(group_id)
    AND NOT public.is_blocked_by(created_by)
  );

-- Per-photo: whoever blocked you sees an album without your photographs.
DROP POLICY IF EXISTS "Group members can view plan photos" ON public.plan_photos;
CREATE POLICY "Group members can view plan photos"
  ON public.plan_photos FOR SELECT
  TO authenticated
  USING (
    public.can_view_plan_photos(plan_id)
    AND NOT public.is_blocked_by(uploaded_by)
  );

-- Per-plan: the album of a plan you cannot see does not exist for you either.
-- This predicate is also what the storage.objects SELECT policy asks, so the
-- check here is what keeps a signed-URL fetch from answering where the table
-- already refused.
CREATE OR REPLACE FUNCTION public.can_view_plan_photos(p_plan_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.plans p
    WHERE p.id = p_plan_id
      AND public.is_group_member(p.group_id)
      AND NOT public.is_blocked_by(p.created_by)
  );
$$;

-- Adding follows seeing. Without this, a leftover yes on one of the blocker's
-- past plans would still let the blocked person push photos into an album the
-- blocker owns — no screen reaches that, but the storage INSERT policy asks
-- this predicate directly, so the API could.
CREATE OR REPLACE FUNCTION public.can_add_plan_photo(p_plan_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.plans p
    WHERE p.id = p_plan_id
      AND p.status <> 'cancelled'
      -- The album opens when the night does, and never closes again. Before
      -- the start there is nothing to photograph, so an empty grid on a plan
      -- three weeks out would be a widget asking to be misused. After it,
      -- there is no deadline: somebody always sorts their camera roll a week
      -- late, and locking them out of their own evening to keep the album
      -- tidy is a bad trade.
      --
      -- The start is the locked date if a flexible plan has one, otherwise
      -- the fixed date. A flexible plan nobody has locked yet has neither,
      -- and NULL fails the comparison, which is the right answer: the night
      -- does not exist yet.
      AND COALESCE(p.locked_date, p.event_date) <= NOW()
      AND public.is_group_member(p.group_id)
      AND NOT public.is_blocked_by(p.created_by)
      AND (
        p.created_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.rsvps r
          WHERE r.plan_id = p.id
            AND r.user_id = auth.uid()
            AND r.response = 'yes'
        )
      )
  );
$$;

-- No policy references has_blocked any more, and no client code ever called
-- it. If a personal mute returns as a product feature it arrives as its own
-- named thing, not by quietly re-pointing this one.
DROP FUNCTION public.has_blocked(UUID);


-- 3. The fan-outs -----------------------------------------------------------
--
-- Every notification filter flips with the policies, because a push is sight:
-- "Marta put up a plan" announces a plan the shield says does not exist for
-- you. The old direction (skip recipients who blocked the creator) is gone —
-- those people keep seeing the plans, so they get the news again. The new
-- direction skips recipients the creator has blocked.
--
-- Merged migrations are immutable, so each function is re-emitted whole from
-- wherever its latest definition lives — notify_plan_created from
-- 20260802000003, lock_plan / cancel_plan / restore_plan from 20260803000000
-- (the is_plan_host versions), promote_from_waitlist from 20260802000005.
-- The only edits are the block predicates; copy and logic are untouched.
-- CREATE OR REPLACE keeps each function's existing ACL, so no grants are
-- re-issued here.
--
-- After dissolve_block_ties (section 4) the blocked person has no rows on the
-- blocker's live plans, and the flipped plans policy stops them adding any
-- (the rsvps and date_availability write policies test plan visibility
-- through their plans subqueries). So these predicates are mostly closing the
-- race where a block lands between someone's RSVP and the fan-out reading it.

CREATE OR REPLACE FUNCTION public.notify_plan_created()
RETURNS TRIGGER AS $$
DECLARE
  v_name TEXT;
BEGIN
  SELECT display_name INTO v_name FROM public.profiles WHERE id = NEW.created_by;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT gm.user_id, 'plan_created', 'New plan',
         CASE
           WHEN NEW.plan_type = 'fixed' THEN
             format('%s put up "%s". Are you in?', v_name, NEW.title)
           ELSE
             format('%s put up "%s". Pick the dates that work.', v_name, NEW.title)
         END,
         jsonb_build_object('plan_id', NEW.id, 'group_id', NEW.group_id)
  FROM public.group_members gm
  WHERE gm.group_id = NEW.group_id
    AND gm.user_id <> NEW.created_by
    AND gm.notify_new_plans
    AND NOT EXISTS (
      SELECT 1 FROM public.blocked_users b
      WHERE b.blocker_id = NEW.created_by
        AND b.blocked_id = gm.user_id
    );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


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
        WHERE b.blocker_id = v_plan.created_by
          AND b.blocked_id = r.user_id
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
  -- every re-lock. Anyone the plan's creator has blocked no longer attends
  -- the creator's plans, so they are seated in neither list; dissolution
  -- normally removed their availability already, and this closes the race
  -- where a block lands between the vote and the lock.
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
        WHERE b.blocker_id = v_plan.created_by
          AND b.blocked_id = da.user_id
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
  -- (flexible), except whoever is cancelling and anyone the creator blocked.
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
      WHERE b.blocker_id = v_plan.created_by
        AND b.blocked_id = u.user_id
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
      WHERE b.blocker_id = v_plan.created_by
        AND b.blocked_id = u.user_id
    );
  GET DIAGNOSTICS v_notified = ROW_COUNT;

  RETURN jsonb_build_object('restored', true, 'status', v_status, 'notified', v_notified);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- promote_from_waitlist: the flip lands in two places. The candidate pick now
-- skips anyone the creator has blocked — they no longer attend the creator's
-- plans, so a freed seat passes them by and goes to the next real candidate
-- (dissolution normally emptied their rows already; this closes the race).
-- And the notification filter is gone entirely: someone who blocked the
-- creator keeps seeing the plan, keeps their seat, and now hears about it,
-- which is the old direction dying.
CREATE OR REPLACE FUNCTION public.promote_from_waitlist()
RETURNS TRIGGER AS $$
DECLARE
  v_plan public.plans%ROWTYPE;
  v_taken INTEGER;
  v_next public.rsvps%ROWTYPE;
  v_date TIMESTAMPTZ;
BEGIN
  -- Only a released seat frees room. This is also what stops the recursion:
  -- the promotion below is an UPDATE on rsvps, and its OLD row is the pending
  -- one, so it falls out here rather than promoting again.
  IF OLD.response IS DISTINCT FROM 'yes' THEN
    RETURN NULL;
  END IF;

  -- NEW is unassigned on a DELETE, so this cannot be folded into the test
  -- above.
  IF TG_OP = 'UPDATE' THEN
    IF NEW.response = 'yes' THEN
      RETURN NULL;
    END IF;
  END IF;

  -- Cancelled plans promote nobody, and neither does a plan being deleted: the
  -- rows cascade out from under us and there is no plan row left to lock.
  SELECT * INTO v_plan
  FROM public.plans
  WHERE id = OLD.plan_id AND status IN ('open', 'locked')
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- NULL cap is "No limit", so there was never a queue to promote from.
  IF v_plan.max_people IS NULL THEN
    RETURN NULL;
  END IF;

  -- A date that has gone by promotes nobody. The 1-day grace matches the one
  -- restore_plan already uses: the client decides "past" at the end of the
  -- local day and the server has no idea which zone that is.
  v_date := COALESCE(v_plan.locked_date, v_plan.event_date);
  IF v_date IS NOT NULL AND v_date < NOW() - INTERVAL '1 day' THEN
    RETURN NULL;
  END IF;

  SELECT COUNT(*) INTO v_taken
  FROM public.rsvps
  WHERE plan_id = OLD.plan_id AND response = 'yes';

  IF v_taken >= v_plan.max_people THEN
    RETURN NULL;
  END IF;

  SELECT r.* INTO v_next
  FROM public.rsvps r
  WHERE r.plan_id = OLD.plan_id AND r.response = 'pending'
    AND NOT EXISTS (
      SELECT 1 FROM public.blocked_users b
      WHERE b.blocker_id = v_plan.created_by
        AND b.blocked_id = r.user_id
    )
  ORDER BY r.waitlist_seq ASC
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- assign_waitlist_seq clears the number on the way through; enforce_plan_cap
  -- re-checks the cap under the lock this function already holds.
  UPDATE public.rsvps
  SET response = 'yes', updated_at = NOW()
  WHERE id = v_next.id;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_next.user_id, 'plan_promoted', 'You''re in',
    format('A place opened up on "%s". You''re in.', v_plan.title),
    jsonb_build_object('plan_id', v_plan.id, 'group_id', v_plan.group_id)
  );

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- 4. What a block dissolves --------------------------------------------------
--
-- The industry consensus, and the part the old mute never did. Facebook
-- unfriends, Instagram deletes the likes and comments, Discord removes the
-- friendship; nobody restores any of it on unblock. Here the ties are: the
-- friendship (any status — a pending request between them is as dead as an
-- accepted one), pending group invites either way, and the blocked person's
-- participation in the blocker's live plans.
--
-- Participation goes only from plans that have not happened: an old yes on a
-- past plan is history, and rewriting history is the mute's mistake in a new
-- costume. "Live" is status open or locked with a date that is not past, with
-- the same 1-day grace every other date test here uses; a flexible plan with
-- no date yet counts as live.
--
-- Deleting a yes fires trg_promote_from_waitlist per row, so a freed seat
-- goes to the next person waiting through exactly the machinery a real
-- withdrawal uses. Nothing here is a special case the queue cannot see.
--
-- What is deliberately NOT dissolved: group membership (an admin's decision,
-- not a side effect), past plans, and the blocker's own rows on the blocked
-- person's plans — the blocker keeps seeing those plans and may keep
-- attending; the shield points one way.
CREATE OR REPLACE FUNCTION public.dissolve_block_ties(p_blocker UUID, p_blocked UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.friendships
  WHERE (requester_id = p_blocker AND addressee_id = p_blocked)
     OR (requester_id = p_blocked AND addressee_id = p_blocker);

  DELETE FROM public.group_invites
  WHERE status = 'pending'
    AND ((invited_by = p_blocker AND invitee_id = p_blocked)
      OR (invited_by = p_blocked AND invitee_id = p_blocker));

  DELETE FROM public.rsvps r
  USING public.plans p
  WHERE r.plan_id = p.id
    AND r.user_id = p_blocked
    AND p.created_by = p_blocker
    AND p.status IN ('open', 'locked')
    AND (COALESCE(p.locked_date, p.event_date) IS NULL
         OR COALESCE(p.locked_date, p.event_date) >= NOW() - INTERVAL '1 day');

  DELETE FROM public.date_availability da
  USING public.plans p
  WHERE da.plan_id = p.id
    AND da.user_id = p_blocked
    AND p.created_by = p_blocker
    AND p.status IN ('open', 'locked')
    AND (COALESCE(p.locked_date, p.event_date) IS NULL
         OR COALESCE(p.locked_date, p.event_date) >= NOW() - INTERVAL '1 day');
END;
$$;

-- Nobody calls this but the trigger below and this migration's backfill. Not
-- even authenticated: the only way to dissolve is to block.
REVOKE ALL ON FUNCTION public.dissolve_block_ties(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- AFTER INSERT catches both ways a block is born — the direct insert from
-- blockUser() and the one inside file_report() — and cannot be forgotten by a
-- third path the way an RPC call could. ON CONFLICT DO NOTHING on a duplicate
-- block inserts no row, so blocking twice dissolves nothing twice.
CREATE OR REPLACE FUNCTION public.dissolve_on_block()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.dissolve_block_ties(NEW.blocker_id, NEW.blocked_id);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.dissolve_on_block() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_dissolve_on_block ON public.blocked_users;
CREATE TRIGGER trg_dissolve_on_block
  AFTER INSERT ON public.blocked_users
  FOR EACH ROW
  EXECUTE FUNCTION public.dissolve_on_block();


-- 5. The two doors: friend requests and group invites ------------------------
--
-- "Cannot contact you." Both RPCs are re-emitted from 20260729000001 with two
-- guards at the top of each; everything else is verbatim.
--
-- The two directions answer differently on purpose. When the target blocked
-- the caller, the answer is a lie — the same 'requested' / 'invited' a real
-- send returns — with no row written, because an honest refusal would
-- announce the block and a block is never announced. When the caller blocked
-- the target, the answer is honest ('you_blocked_them'): the caller knows
-- about their own block, and silently pretending to invite someone you
-- blocked helps nobody.
--
-- The guards also retire send_friend_request's auto-accept for any blocked
-- pair: the crossing-request path sits below them, so "their request was
-- already on the table" can never marry two people a block separates.
-- (Dissolution already deleted any such pending row; this keeps the property
-- true even against a request that lands mid-block.)

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

  IF EXISTS (
    SELECT 1 FROM public.blocked_users
    WHERE blocker_id = v_uid AND blocked_id = p_addressee
  ) THEN
    RETURN jsonb_build_object('status', 'you_blocked_them');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.blocked_users
    WHERE blocker_id = p_addressee AND blocked_id = v_uid
  ) THEN
    RETURN jsonb_build_object('status', 'requested');
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


-- 6. Search that cannot reveal -----------------------------------------------
--
-- "Cannot find you." The find-people screen searched profiles directly with
-- ilike, and no client-side filter can implement this half of the rule: the
-- exclusion list is who blocked *me*, which is exactly the set RLS keeps the
-- client from ever reading. So the search moves server-side, where the filter
-- runs without the answer's shape betraying it — twenty results with someone
-- silently absent look identical to twenty results where they never matched.
--
-- People the caller blocked still appear: the blocker keeps seeing them, and
-- the two RPC guards above are what answer if they try to reconnect.
CREATE OR REPLACE FUNCTION public.search_people(p_query TEXT)
RETURNS TABLE (id UUID, display_name TEXT, handle TEXT, avatar_url TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- The client strips %,() before sending; the server cannot rely on that.
  -- Wildcards and the escape character are stripped rather than escaped: a
  -- name cannot contain them, so the only thing they could be is a probe.
  v_q TEXT := regexp_replace(TRIM(COALESCE(p_query, '')), '[%_\\]', '', 'g');
BEGIN
  IF auth.uid() IS NULL OR length(v_q) < 2 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p.id, p.display_name, p.handle, p.avatar_url
  FROM public.profiles p
  WHERE p.id <> auth.uid()
    AND (p.handle ILIKE '%' || v_q || '%' OR p.display_name ILIKE '%' || v_q || '%')
    AND NOT EXISTS (
      SELECT 1 FROM public.blocked_users b
      WHERE b.blocker_id = p.id AND b.blocked_id = auth.uid()
    )
  ORDER BY p.display_name ASC
  LIMIT 20;
END;
$$;

REVOKE ALL ON FUNCTION public.search_people(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_people(TEXT) TO authenticated;


-- 7. Backfill: existing blocks get the same dissolution -----------------------
--
-- Blocks made under the mute era promised less than the shield does. The rows
-- keep their meaning by passing through the same function a new block does —
-- friendship gone, pending invites gone, participation in the blocker's live
-- plans gone, with any freed seats promoting through the queue. Runs after
-- the function definitions above so promotions use the flipped logic.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT blocker_id, blocked_id FROM public.blocked_users LOOP
    PERFORM public.dissolve_block_ties(r.blocker_id, r.blocked_id);
  END LOOP;
END $$;
