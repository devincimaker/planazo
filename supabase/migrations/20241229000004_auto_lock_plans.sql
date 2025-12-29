-- Auto-lock fixed plans when minimum people RSVP yes

CREATE OR REPLACE FUNCTION public.check_and_lock_plan()
RETURNS TRIGGER AS $$
DECLARE
  plan_record RECORD;
  yes_count INTEGER;
BEGIN
  -- Only proceed if this is a 'yes' response
  IF NEW.response != 'yes' THEN
    RETURN NEW;
  END IF;

  -- Get the plan details
  SELECT * INTO plan_record
  FROM public.plans
  WHERE id = NEW.plan_id;

  -- Only lock fixed plans that are still open
  IF plan_record.plan_type != 'fixed' OR plan_record.status != 'open' THEN
    RETURN NEW;
  END IF;

  -- Count yes responses (including this new one)
  SELECT COUNT(*) INTO yes_count
  FROM public.rsvps
  WHERE plan_id = NEW.plan_id AND response = 'yes';

  -- If we've reached minimum, lock the plan
  IF yes_count >= plan_record.min_people THEN
    UPDATE public.plans
    SET status = 'locked',
        locked_at = NOW(),
        locked_date = event_date
    WHERE id = NEW.plan_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger after RSVP insert or update
DROP TRIGGER IF EXISTS on_rsvp_check_lock ON public.rsvps;
CREATE TRIGGER on_rsvp_check_lock
  AFTER INSERT OR UPDATE ON public.rsvps
  FOR EACH ROW
  EXECUTE FUNCTION public.check_and_lock_plan();
