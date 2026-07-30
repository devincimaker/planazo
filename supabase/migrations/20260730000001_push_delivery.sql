-- Push notifications (Endgame item 1).
--
-- Three pieces:
--   1. profiles.push_enabled — the 12b "Notify me" toggle. Gates push
--      DELIVERY only; in-app notification rows (feed notices) are unaffected.
--   2. plan_created fan-out — nothing wrote this type before. A trigger on
--      plans notifies every group member who kept the group's "Notify me on
--      new plans" preference on, except the creator.
--   3. Delivery — a pg_net trigger on notifications POSTs {id} to the
--      send-push Edge Function, authenticated by a shared secret in Vault
--      (the app's publishable API key is not a JWT, so the function runs
--      with verify_jwt off and checks this header itself). If the secret
--      is missing or the POST errors, the insert still succeeds — pushes
--      are best-effort, the in-app feed is the source of truth.

ALTER TABLE public.profiles ADD COLUMN push_enabled BOOLEAN NOT NULL DEFAULT true;

-- When delivery was handed off (or deliberately skipped). The Edge Function
-- claims the row by stamping this before sending, so retries can't double-send.
ALTER TABLE public.notifications ADD COLUMN pushed_at TIMESTAMPTZ;

-- 2. plan_created fan-out ----------------------------------------------------

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
    AND gm.notify_new_plans;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_notify_plan_created
  AFTER INSERT ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.notify_plan_created();

-- 3. delivery webhook --------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.push_notification_webhook()
RETURNS TRIGGER AS $$
DECLARE
  v_secret TEXT;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'send_push_secret';

    IF v_secret IS NOT NULL THEN
      PERFORM net.http_post(
        url := 'https://lmgjdvacivzzhctgctqa.supabase.co/functions/v1/send-push',
        body := jsonb_build_object('id', NEW.id),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-push-secret', v_secret
        )
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'push webhook failed for notification %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_push_notification
  AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.push_notification_webhook();
