-- A block has to reach the notifications too.
--
-- The plans SELECT policy already hides a blocked person's plans, but
-- notify_plan_created fans out to every member with notify_new_plans on and
-- knew nothing about blocks. The result was the worst of both: a push saying
-- "<person you blocked> put up a plan", which opens to nothing because RLS
-- correctly refuses to show it. Blocking someone and then being told what they
-- are up to is precisely the thing the button promised to stop.
--
-- has_blocked() is no use here — it answers for auth.uid(), and this runs once
-- for a whole room of recipients — so the check is per-recipient inline.

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
             format('%s put up "%s" — are you in?', v_name, NEW.title)
           ELSE
             format('%s put up "%s" — pick the dates that work.', v_name, NEW.title)
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
