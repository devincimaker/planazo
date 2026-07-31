-- PLA-20: max_people was decorative.
--
-- The cap was written at create and read for display ("caps at 6", "room for
-- 4 more") and that was the entire implementation: no constraint, no trigger,
-- and no function in this schema referenced it. A plan capped at 6 accepted a
-- 7th and 8th yes without complaint, and lock_plan — which turns everyone
-- available on the chosen date into a yes — could blow past the cap in one
-- shot.
--
-- Two halves, and both are needed: a guard on the table so no write path can
-- oversubscribe a plan, and a fix to lock_plan so it seats only what it has
-- room for.
--
-- The cap deliberately binds on yes-RSVPs ONLY. Marking availability on an
-- open flexible plan is not a seat — attendance isn't decided until the lock.
-- Twelve people can be free on Friday for a plan capped at 6; that is a
-- healthy vote, not an error. The cap becomes real at the moment availability
-- becomes attendance.

-- A CHECK constraint cannot count across rows, and an RLS WITH CHECK would
-- both report as an opaque 42501 and be bypassed by lock_plan, which is
-- SECURITY DEFINER. A trigger is the only guard that covers every write path.
CREATE OR REPLACE FUNCTION public.enforce_plan_cap()
RETURNS TRIGGER AS $$
DECLARE
  v_cap INTEGER;
  v_taken INTEGER;
BEGIN
  -- Only a yes takes a seat. Withdrawing or declining is always allowed —
  -- see 20260731000000, where being unable to get out was its own bug.
  IF NEW.response IS DISTINCT FROM 'yes' THEN
    RETURN NEW;
  END IF;

  -- FOR UPDATE serialises every cap check on this plan. Without it two people
  -- tapping "I'm in" at once both read 5-of-6 and both get in. lock_plan
  -- already holds this same row lock, so the two compose rather than deadlock.
  SELECT max_people INTO v_cap
  FROM public.plans
  WHERE id = NEW.plan_id
  FOR UPDATE;

  -- NULL cap is "No limit" in the create sheet, not a missing value.
  IF v_cap IS NULL THEN
    RETURN NEW;
  END IF;

  -- Excluding NEW.user_id is load-bearing, not a micro-optimisation. The app
  -- writes RSVPs with .upsert(onConflict), i.e. INSERT ... ON CONFLICT DO
  -- UPDATE, so BEFORE INSERT fires first with the user's own existing 'yes'
  -- still on the table. Counting yourself would make re-confirming a seat you
  -- already hold fail on a full plan. It is also correct for a true insert,
  -- where there is no row of yours to exclude.
  SELECT COUNT(*) INTO v_taken
  FROM public.rsvps
  WHERE plan_id = NEW.plan_id
    AND response = 'yes'
    AND user_id <> NEW.user_id;

  IF v_taken >= v_cap THEN
    -- PostgREST's PTxyz convention: the SQLSTATE sets the HTTP status, so the
    -- client gets a 409 with code 'PT409' rather than a generic 500. That is
    -- what lets the app say "this one's full" instead of "something broke".
    RAISE EXCEPTION 'This plan is full'
      USING ERRCODE = 'PT409',
            DETAIL = format('%s of %s places are taken', v_taken, v_cap),
            HINT = 'Someone has to drop out before another person can join.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_enforce_plan_cap ON public.rsvps;
CREATE TRIGGER trg_enforce_plan_cap
  BEFORE INSERT OR UPDATE ON public.rsvps
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_plan_cap();


-- lock_plan: seat at most max_people.
--
-- Unchanged from 20260728000002 except for the flexible branch's conversion
-- step and the notification that follows it, which must agree on exactly who
-- got in.
--
-- Ordering is by date_availability.created_at — first-come-first-served is the
-- only rule that is both deterministic and explainable to the people who miss
-- out ("the first 6 who said Friday works are in"). user_id breaks ties so two
-- rows written in the same tick can't reorder between the seating and the
-- notification.
--
-- Whoever doesn't fit gets no RSVP row and no notification. That is the honest
-- interim state: the waiting list that gives them somewhere to land is the
-- next change, not this one.
CREATE OR REPLACE FUNCTION public.lock_plan(
  p_plan_id UUID,
  p_date_option_id UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_plan public.plans%ROWTYPE;
  v_authorized BOOLEAN;
  v_yes_count INTEGER;
  v_option RECORD;
  v_notified INTEGER := 0;
  v_held INTEGER;
  v_limit INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_plan FROM public.plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan not found';
  END IF;

  SELECT (v_plan.created_by = v_uid) OR EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = v_plan.group_id AND user_id = v_uid AND role = 'admin'
  ) INTO v_authorized;
  IF NOT v_authorized THEN
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
    WHERE r.plan_id = p_plan_id AND r.response = 'yes';
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

  -- Seats already held by someone who is NOT free on the locked date. On the
  -- happy path this is zero — declining deletes your availability — but if any
  -- such row exists it is a real seat, and ignoring it would let the seating
  -- below trip the trigger and abort the host's whole lock.
  SELECT COUNT(*) INTO v_held
  FROM public.rsvps r
  WHERE r.plan_id = p_plan_id
    AND r.response = 'yes'
    AND NOT EXISTS (
      SELECT 1 FROM public.date_availability da
      WHERE da.date_option_id = v_option.id
        AND da.available
        AND da.user_id = r.user_id
    );

  -- NULL is "No limit", and LIMIT NULL is LIMIT ALL — so an uncapped plan
  -- seats everyone, exactly as it did before this migration.
  v_limit := CASE
    WHEN v_plan.max_people IS NULL THEN NULL
    ELSE GREATEST(v_plan.max_people - v_held, 0)
  END;

  -- Availability on the locked date becomes attendance, up to the cap. The
  -- data-modifying CTE runs exactly once and both consumers read the same
  -- `seated` set, so the RSVPs and the notifications cannot disagree.
  WITH seated AS (
    SELECT da.user_id
    FROM public.date_availability da
    WHERE da.date_option_id = v_option.id AND da.available
    ORDER BY da.created_at ASC, da.user_id ASC
    LIMIT v_limit
  ),
  seated_rsvps AS (
    INSERT INTO public.rsvps (plan_id, user_id, response)
    SELECT p_plan_id, s.user_id, 'yes' FROM seated s
    ON CONFLICT (plan_id, user_id) DO UPDATE SET response = 'yes'
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

REVOKE ALL ON FUNCTION public.lock_plan(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lock_plan(UUID, UUID) TO authenticated;
