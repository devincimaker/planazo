-- Feedback (design 14a-14c): one row per submission. The compose screen
-- promises "your name, phone model and app version go with it" — name comes
-- from user_id, the other two are stamped by the client at send time.

CREATE TABLE public.feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('broken', 'idea', 'other')),
  message TEXT NOT NULL DEFAULT '',
  screenshot_path TEXT,
  app_version TEXT,
  device_model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- Write-only from the app: users file feedback but never read it back
-- (14c drops you straight back where you were). It is read from the
-- dashboard with the service role.
CREATE POLICY "Users can send their own feedback"
  ON public.feedback FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Private bucket for attached screenshots — they show whatever screen the
-- user was on, so no public read (unlike avatars). Dashboard reads via
-- service role.
INSERT INTO storage.buckets (id, name, public)
VALUES ('feedback-screenshots', 'feedback-screenshots', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users can upload their own feedback screenshots"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'feedback-screenshots' AND
  (storage.foldername(name))[1] = auth.uid()::text
);
