-- Plan endings (design 20a/20b, 19a–19e): cancellations carry who/when/why,
-- and a cancelled plan can be restored ("Reopen this plan", 19b) while its
-- date is still ahead. Restoring notifies everyone who was in.

-- Who called it off, when, and why (the stone card on 19a/19b).
ALTER TABLE public.plans ADD COLUMN cancelled_at TIMESTAMPTZ;
ALTER TABLE public.plans ADD COLUMN cancelled_by UUID REFERENCES public.profiles(id);
ALTER TABLE public.plans ADD COLUMN cancel_reason TEXT;

-- Restore gets its own notification type.
ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'plan_created', 'plan_locked', 'plan_cancelled', 'plan_reopened',
    'invited_to_group', 'kicked_from_group'
  ));

-- cancel_plan grows an optional reason. Existing callers that pass only
-- p_plan_id keep working via the default.
DROP FUNCTION IF EXISTS public.cancel_plan(UUID);

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

  -- Everyone who said yes (fixed) or marked availability (flexible),
  -- except whoever is cancelling.
  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT DISTINCT u.user_id, 'plan_cancelled', 'Called off',
         CASE
           WHEN v_reason IS NOT NULL THEN
             format('%s called off "%s" — "%s"', v_name, v_plan.title, v_reason)
           ELSE
             format('%s called off "%s".', v_name, v_plan.title)
         END,
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

REVOKE ALL ON FUNCTION public.cancel_plan(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_plan(UUID, TEXT) TO authenticated;

-- Un-cancel (19b "Reopen this plan"). Host/admin only, and only while the
-- plan's date is still ahead — after that there is nothing to return to.
-- Everyone who was in stays in: rsvps and availability were never cleared.
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

  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT DISTINCT u.user_id, 'plan_reopened', 'Back on',
         CASE
           WHEN v_status = 'locked' OR v_plan.plan_type = 'fixed' THEN
             format('"%s" is back on — you''re still counted in.', v_plan.title)
           ELSE
             format('"%s" is back on — your dates still stand.', v_plan.title)
         END,
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

  RETURN jsonb_build_object('restored', true, 'status', v_status, 'notified', v_notified);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.restore_plan(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_plan(UUID) TO authenticated;
