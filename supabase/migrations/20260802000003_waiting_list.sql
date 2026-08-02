-- The waiting list: an over-cap yes lands as 'pending', and the oldest pending
-- is promoted the moment a seat is released (PLA-37).
--
-- 20260731000001 made the cap real but left two holes it named at the time:
-- whoever lock_plan could not seat got no row and no notification, and a place
-- freed by a withdrawal (20260731000000) went to whoever happened to refresh
-- first. This closes both. rsvps.response has permitted 'pending' since the
-- initial schema and nothing has ever written it, so no CHECK changes here.
--
-- What this does NOT change: enforce_plan_cap. It still raises PT409 on a yes
-- that would exceed the cap, which is now the *race* path rather than the
-- normal one. Joining the list is an explicit act ("Take the next spot"), not a
-- trigger quietly rewriting what somebody asked for; PT409 is what the client
-- catches when a plan fills between the render and the tap, and it answers by
-- offering the list.
--
-- The locking rule, which everything here obeys: take
-- SELECT ... FROM plans WHERE id = ... FOR UPDATE before reading or changing
-- who holds a seat. enforce_plan_cap and lock_plan already do. Two people
-- withdrawing at once would otherwise both see a free seat and promote two
-- people into one place.


-- 1. The queue needs a total order, and created_at cannot give one
--
-- lock_plan waitlists its whole overflow in a single statement, so every one of
-- those rows carries the same transaction timestamp: three people, one instant,
-- no defensible order. A position we show has to be one we can defend, hence an
-- explicit sequence number per plan.
--
-- Gaps are fine and expected (a promotion nulls its row's number, a withdrawal
-- takes one out of the middle). Position is derived by counting the pending
-- rows ahead of you, never by reading the number itself.
ALTER TABLE public.rsvps ADD COLUMN waitlist_seq INTEGER;

-- Two people can never hold the same place in the same queue. Partial, so the
-- NULL every non-pending row carries costs nothing and never collides.
CREATE UNIQUE INDEX idx_rsvps_waitlist
  ON public.rsvps (plan_id, waitlist_seq)
  WHERE response = 'pending';


-- 2. The number is not the client's to write
--
-- RLS is row-level: the "own row on a live plan" policies from 20260731000000
-- would happily let someone set their own waitlist_seq to 0 and jump the queue.
-- Column privileges are the thing that bounds *which* columns a write may
-- touch, exactly as 20260802000002 did for plans.status.
--
-- The three columns granted are the three the app actually sends
-- (plan/create.tsx seeds the host's yes; both screens upsert on the
-- plan_id,user_id conflict). PostgREST's upsert updates every column it was
-- handed, so plan_id and user_id need the UPDATE grant too even though they
-- only ever get rewritten to the values they already hold. SELECT and DELETE
-- are untouched: reading the queue and leaving it both stay as they were.
REVOKE INSERT, UPDATE ON public.rsvps FROM authenticated, anon;
GRANT INSERT (plan_id, user_id, response),
      UPDATE (plan_id, user_id, response)
  ON public.rsvps TO authenticated;


-- 3. Taking a place in the queue
--
-- A place is yours from the moment you take it until you leave it or it turns
-- into a seat. Nothing renumbers you in between: a re-lock, a re-tap, a
-- superseding write all preserve the number you already hold, because the only
-- branch that allocates is the one where there is no number yet.
--
-- The explicit-number branch is what lets lock_plan hand down availability
-- order for a whole batch instead of depending on the order rows happen to be
-- produced in. Clients cannot reach that branch, because they cannot write the
-- column at all (see 2).
CREATE OR REPLACE FUNCTION public.assign_waitlist_seq()
RETURNS TRIGGER AS $$
BEGIN
  -- Leaving the list, or never on it: no number to hold.
  IF NEW.response IS DISTINCT FROM 'pending' THEN
    NEW.waitlist_seq := NULL;
    RETURN NEW;
  END IF;

  -- A place already held, or one lock_plan computed. Keep it.
  IF NEW.waitlist_seq IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Same lock enforce_plan_cap and lock_plan take, in the same order, so the
  -- three compose rather than deadlock. Without it two people joining at once
  -- both read the same MAX and collide on idx_rsvps_waitlist.
  PERFORM 1 FROM public.plans WHERE id = NEW.plan_id FOR UPDATE;

  SELECT COALESCE(MAX(waitlist_seq), 0) + 1 INTO NEW.waitlist_seq
  FROM public.rsvps
  WHERE plan_id = NEW.plan_id AND response = 'pending';

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Sorts before trg_enforce_plan_cap, which is fine either way: the cap trigger
-- only acts on a yes, and this one only on a pending.
DROP TRIGGER IF EXISTS trg_assign_waitlist_seq ON public.rsvps;
CREATE TRIGGER trg_assign_waitlist_seq
  BEFORE INSERT OR UPDATE ON public.rsvps
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_waitlist_seq();


-- 4. Turning a freed seat into somebody's place
--
-- A trigger, not an RPC, because a seat is freed by five different paths and
-- only a trigger catches all of them: deleteOwnRsvp (the PLA-16 withdrawal),
-- an upsert to 'no', cleanup_user_on_leave_group (20241229000006, a bulk
-- delete across every plan in a group when someone leaves or is kicked), the
-- profile cascade from delete_my_account, and whatever the sixth one turns out
-- to be. An RPC would have to be remembered at each site; this cannot be
-- forgotten.
--
-- One invocation promotes at most one person, which is the correct arithmetic:
-- FOR EACH ROW means a statement that frees three seats fires three times, and
-- each fires after the whole statement, so each sees the true remaining count.
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

  SELECT * INTO v_next
  FROM public.rsvps
  WHERE plan_id = OLD.plan_id AND response = 'pending'
  ORDER BY waitlist_seq ASC
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- assign_waitlist_seq clears the number on the way through; enforce_plan_cap
  -- re-checks the cap under the lock this function already holds.
  UPDATE public.rsvps
  SET response = 'yes', updated_at = NOW()
  WHERE id = v_next.id;

  -- Same block rule as every other fan-out (20260802000001): somebody who
  -- blocked the creator cannot see the plan, so news about it opens to nothing.
  -- They keep the seat regardless. It is theirs, they just are not told.
  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT v_next.user_id, 'plan_promoted', 'You''re in',
         format('A place opened up on "%s". You''re in.', v_plan.title),
         jsonb_build_object('plan_id', v_plan.id, 'group_id', v_plan.group_id)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.blocked_users b
    WHERE b.blocker_id = v_next.user_id
      AND b.blocked_id = v_plan.created_by
  );

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_promote_from_waitlist ON public.rsvps;
CREATE TRIGGER trg_promote_from_waitlist
  AFTER DELETE OR UPDATE ON public.rsvps
  FOR EACH ROW
  EXECUTE FUNCTION public.promote_from_waitlist();


-- 5. A promotion is news, so it needs a type
ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'plan_created', 'plan_locked', 'plan_cancelled', 'plan_reopened',
    'plan_promoted', 'invited_to_group', 'kicked_from_group'
  ));


-- 6. lock_plan: the overflow lands on the list instead of on the floor
--
-- Forked from 20260802000001, so the block filters come with it. The only
-- change is the seating block: what was a LIMIT that dropped everyone past the
-- cap is now a rank that splits them into seated and waiting.
--
-- Waiters get no plan_locked push. Theirs is plan_promoted, if and when it
-- comes; telling somebody who did not get in that "this is happening" would be
-- a lie.
--
-- Copy note: the em dashes in the bodies below predate the rule in AGENTS.md
-- and are rewritten here rather than carried forward, since this file reissues
-- them anyway.
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
  v_base INTEGER;
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


-- 7. Somebody waiting is waiting for news, and this is the news
--
-- cancel_plan and restore_plan, forked from 20260802000001. The recipient set
-- widens from "said yes" to "said yes or is waiting". Staying silent would
-- leave a waiter checking a plan that is never coming back, which is the one
-- thing a waiting list must not do.
--
-- On a flexible plan most waiters were already reached, since they are in
-- date_availability and the union picks them up; on a fixed plan nothing
-- reached them at all.
CREATE OR REPLACE FUNCTION public.cancel_plan(p_plan_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_plan public.plans%ROWTYPE;
  v_authorized BOOLEAN;
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

  SELECT (v_plan.created_by = v_uid) OR EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = v_plan.group_id AND user_id = v_uid AND role = 'admin'
  ) INTO v_authorized;
  IF NOT v_authorized THEN
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


-- restore_plan, same widening. It needs a third line of copy, because neither
-- "you're still counted in" nor "your dates still stand" is true of somebody
-- who is waiting. Telling them it died and never telling them it came back
-- would be worse than having said nothing.
CREATE OR REPLACE FUNCTION public.restore_plan(p_plan_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_plan public.plans%ROWTYPE;
  v_authorized BOOLEAN;
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

  SELECT (v_plan.created_by = v_uid) OR EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = v_plan.group_id AND user_id = v_uid AND role = 'admin'
  ) INTO v_authorized;
  IF NOT v_authorized THEN
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


-- 8. The last of the em dashes in push copy
--
-- AGENTS.md forbids them in every string a user can see and names push text
-- explicitly. The pass that removed the other nineteen only reached the app and
-- the web copy, because these live in SQL. This function has no other reason to
-- change; it is reissued verbatim apart from the two bodies.
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
      WHERE b.blocker_id = gm.user_id
        AND b.blocked_id = NEW.created_by
    );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
