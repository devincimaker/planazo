-- The push webhook had its endpoint hardcoded to a single project ref, which
-- broke in two ways:
--
--   1. The live project moved. The old ref stayed baked into the already-applied
--      function, so notifications on the new project POSTed at the retired one.
--   2. Every Supabase branch database inherits this trigger. A branch would fire
--      pushes at the parent project's Edge Function using the parent's secret.
--
-- Read the endpoint from Vault alongside the secret instead, and require both.
-- Environments that set neither (local, branch databases, CI) keep the existing
-- behaviour exactly: the webhook silently does nothing and the notification
-- INSERT still succeeds — which is what the integration suite asserts.

CREATE OR REPLACE FUNCTION public.push_notification_webhook()
RETURNS TRIGGER AS $$
DECLARE
  v_secret TEXT;
  v_url TEXT;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'send_push_secret';

    SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets
    WHERE name = 'send_push_url';

    IF v_secret IS NOT NULL AND v_url IS NOT NULL THEN
      PERFORM net.http_post(
        url := v_url,
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
