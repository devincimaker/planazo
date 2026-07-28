-- Host action: reopen a locked flexible plan's vote (design 9a — "Lock in
-- ends the vote; tap it again to reopen"). Same authorization model as
-- lock_plan/cancel_plan.

CREATE OR REPLACE FUNCTION public.reopen_plan(p_plan_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_plan public.plans%ROWTYPE;
  v_authorized BOOLEAN;
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

REVOKE ALL ON FUNCTION public.reopen_plan(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reopen_plan(UUID) TO authenticated;
