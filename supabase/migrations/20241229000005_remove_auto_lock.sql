-- Remove the auto-lock trigger - we'll show "confirmed" visually based on RSVP count
-- but keep plans open so more people can still RSVP

DROP TRIGGER IF EXISTS on_rsvp_check_lock ON public.rsvps;
DROP FUNCTION IF EXISTS public.check_and_lock_plan();
