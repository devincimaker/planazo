-- Function to clean up user's plan responses when leaving a group
CREATE OR REPLACE FUNCTION cleanup_user_on_leave_group()
RETURNS TRIGGER AS $$
BEGIN
  -- Delete RSVPs for plans in this group
  DELETE FROM public.rsvps
  WHERE user_id = OLD.user_id
    AND plan_id IN (
      SELECT id FROM public.plans WHERE group_id = OLD.group_id
    );

  -- Delete date availabilities for plans in this group
  DELETE FROM public.date_availability
  WHERE user_id = OLD.user_id
    AND date_option_id IN (
      SELECT pdo.id
      FROM public.plan_date_options pdo
      JOIN public.plans p ON p.id = pdo.plan_id
      WHERE p.group_id = OLD.group_id
    );

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger that fires before deleting a group member
CREATE TRIGGER on_group_member_delete
  BEFORE DELETE ON public.group_members
  FOR EACH ROW
  EXECUTE FUNCTION cleanup_user_on_leave_group();
