-- Server-authoritative plan actions, replacing the Express API's
-- /check-lock and /cancel routes (apps/api is removed in the same change).
-- Confirmation math must stay in sync with packages/shared/src/plan-logic.ts.
--
-- Both functions are host actions: only the plan creator or a group admin
-- may call them (the old API let any authenticated user trigger check-lock
-- on any plan).

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

  -- Flexible: the chosen option, or the most-available viable one.
  -- A date is only lockable at or above min_people (the plan's floor).
  -- Ties break toward the earlier date, matching bestViableOption().
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

  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT da.user_id, 'plan_locked', 'Plan Confirmed!',
         format('"%s" is happening on %s!', v_plan.title, to_char(v_option.date, 'FMDay DD Mon')),
         jsonb_build_object('plan_id', p_plan_id, 'group_id', v_plan.group_id)
  FROM public.date_availability da
  WHERE da.date_option_id = v_option.id AND da.available;
  GET DIAGNOSTICS v_notified = ROW_COUNT;

  RETURN jsonb_build_object(
    'locked', true,
    'locked_date', v_option.date,
    'notified', v_notified
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.cancel_plan(p_plan_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_plan public.plans%ROWTYPE;
  v_authorized BOOLEAN;
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
    RAISE EXCEPTION 'Only the plan creator or a group admin can cancel a plan';
  END IF;

  IF v_plan.status = 'cancelled' THEN
    RETURN jsonb_build_object('cancelled', true, 'already_cancelled', true);
  END IF;

  UPDATE public.plans
  SET status = 'cancelled', updated_at = NOW()
  WHERE id = p_plan_id;

  -- Everyone who said yes (fixed) or marked availability (flexible),
  -- except whoever is cancelling.
  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT DISTINCT u.user_id, 'plan_cancelled', 'Plan Cancelled',
         format('"%s" was cancelled.', v_plan.title),
         jsonb_build_object('plan_id', p_plan_id, 'group_id', v_plan.group_id)
  FROM (
    SELECT r.user_id FROM public.rsvps r
    WHERE r.plan_id = p_plan_id AND r.response = 'yes'
    UNION
    SELECT da.user_id FROM public.date_availability da
    WHERE da.plan_id = p_plan_id AND da.available
  ) u
  WHERE u.user_id <> v_uid;
  GET DIAGNOSTICS v_notified = ROW_COUNT;

  RETURN jsonb_build_object('cancelled', true, 'notified', v_notified);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.lock_plan(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_plan(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lock_plan(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_plan(UUID) TO authenticated;
