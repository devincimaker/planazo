-- PLA-32: a shared album on a plan.
--
-- Every surface in Planazo until now has been about the *before*: deciding,
-- answering, locking in. Once a plan is past it goes quiet. This is the first
-- thing that gives a plan a life afterwards, and the first reason to open an
-- old one.
--
-- Two choices here cost more than their alternative, and both were made on
-- purpose.
--
--   1. **The bucket is private.** `avatars` is public and `getPublicUrl` is
--      the only storage read this app has ever done, so an album brings in
--      signed URLs, expiry, and re-signing. A public bucket with unguessable
--      paths would have shipped a day sooner. It also means a link that
--      escapes stays fetchable by anyone forever, including by someone who
--      has since left the group. Every other private thing here is protected
--      by RLS and photos of somebody's living room are not the place to start
--      making exceptions.
--
--   2. **`uploaded_by` cascades.** Compare `plans.created_by`, which is SET
--      NULL so a plan outlives whoever posted it. A photo is different: it is
--      the uploader's own content, `delete_my_account` promises to take what
--      is theirs, and an album quietly losing half a night is the honest
--      price of keeping that promise. The album is not a reason to hold onto
--      someone's files after they asked to be gone.

-- ---------------------------------------------------------------- predicates
--
-- Who may see an album, and who may add to it. Both live in functions because
-- each is asked twice: once by this table's RLS, and once by the storage
-- policies on the object itself. Written out twice they would drift, and the
-- failure that produces is the worst kind — a row you can read pointing at a
-- file you cannot fetch, or a file readable by someone the row would have
-- hidden.
--
-- SECURITY DEFINER for the same reason `is_group_member` is: called from
-- another table's policy, these must not re-enter the RLS of what they read.

CREATE OR REPLACE FUNCTION public.can_view_plan_photos(p_plan_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.plans p
    WHERE p.id = p_plan_id
      AND public.is_group_member(p.group_id)
  );
$$;

-- Adding is narrower than viewing: the album belongs to the people who were
-- actually there. The whole group gets to look, because a group is who the
-- plan was posted to, but someone who said no does not get to fill the album
-- of a night they skipped. The host counts regardless — they may have been
-- the one holding the camera, and they own the plan either way.
CREATE OR REPLACE FUNCTION public.can_add_plan_photo(p_plan_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.plans p
    WHERE p.id = p_plan_id
      AND p.status <> 'cancelled'
      -- The album opens when the night does, and never closes again. Before
      -- the start there is nothing to photograph, so an empty grid on a plan
      -- three weeks out would be a widget asking to be misused. After it,
      -- there is no deadline: somebody always sorts their camera roll a week
      -- late, and locking them out of their own evening to keep the album
      -- tidy is a bad trade.
      --
      -- The start is the locked date if a flexible plan has one, otherwise
      -- the fixed date. A flexible plan nobody has locked yet has neither,
      -- and NULL fails the comparison, which is the right answer: the night
      -- does not exist yet.
      AND COALESCE(p.locked_date, p.event_date) <= NOW()
      AND public.is_group_member(p.group_id)
      AND (
        p.created_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.rsvps r
          WHERE r.plan_id = p.id
            AND r.user_id = auth.uid()
            AND r.response = 'yes'
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.can_view_plan_photos(UUID) FROM public;
REVOKE ALL ON FUNCTION public.can_add_plan_photo(UUID) FROM public;
GRANT EXECUTE ON FUNCTION public.can_view_plan_photos(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_add_plan_photo(UUID) TO authenticated;

-- ------------------------------------------------------------------- the rows

CREATE TABLE public.plan_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- `<plan_id>/<uploader_id>/<photo_id>.jpg`. Derivable from the other three
  -- columns, and stored anyway: the account purge reads exact paths straight
  -- out of this column, and a stored path cannot drift from the object the
  -- way a recomputed one can after a rename.
  storage_path TEXT NOT NULL UNIQUE,

  -- Known at pick time, kept so the grid can lay out and reserve aspect
  -- ratio before a single byte of image has arrived.
  width INTEGER,
  height INTEGER,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_plan_photos_plan ON public.plan_photos(plan_id, created_at DESC);
CREATE INDEX idx_plan_photos_uploader ON public.plan_photos(uploaded_by);

ALTER TABLE public.plan_photos ENABLE ROW LEVEL SECURITY;

-- Blocking bites here the same way it bites on plans (20260802000000): the
-- row disappears rather than being filtered by a client that might forget.
-- Photos are the strongest case for it in the app. Blocking someone and then
-- scrolling past their photographs would make the button a liar.
CREATE POLICY "Group members can view plan photos"
  ON public.plan_photos FOR SELECT
  TO authenticated
  USING (
    public.can_view_plan_photos(plan_id)
    AND NOT public.has_blocked(uploaded_by)
  );

CREATE POLICY "People who were in the plan can add photos"
  ON public.plan_photos FOR INSERT
  TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND public.can_add_plan_photo(plan_id)
  );

-- v1 is uploader-only. Handing the host a delete is a moderation power, and
-- the report-and-block path already covers the case it would be used for.
-- Adding it later is one policy; taking it back once people have it is not.
CREATE POLICY "Uploaders can remove their own photos"
  ON public.plan_photos FOR DELETE
  TO authenticated
  USING (uploaded_by = auth.uid());

-- No UPDATE policy. A photo has nothing worth editing, and the absence means
-- swapping the file under a path that other people have already seen is not
-- expressible.

-- ---------------------------------------------------------------- the ceiling
--
-- Storage is the heaviest thing this product would hold, so the cap is in the
-- database rather than in a client anyone can bypass. Two limits, because
-- they stop different things: the per-plan one keeps a night's album
-- browsable, the per-person one stops one enthusiast filling it alone.
--
-- Numbers are a guess, deliberately generous enough that nobody meets them by
-- accident on a real evening out.

CREATE OR REPLACE FUNCTION public.enforce_photo_caps()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_total INTEGER;
  v_mine INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_plan_total
  FROM public.plan_photos WHERE plan_id = NEW.plan_id;

  IF v_plan_total >= 200 THEN
    RAISE EXCEPTION 'plan_photo_cap_reached'
      USING HINT = 'This album is full at 200 photos.';
  END IF;

  SELECT COUNT(*) INTO v_mine
  FROM public.plan_photos
  WHERE plan_id = NEW.plan_id AND uploaded_by = NEW.uploaded_by;

  IF v_mine >= 20 THEN
    RAISE EXCEPTION 'user_photo_cap_reached'
      USING HINT = 'You have added 20 photos to this plan.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_photo_caps
  BEFORE INSERT ON public.plan_photos
  FOR EACH ROW EXECUTE FUNCTION public.enforce_photo_caps();

-- ---------------------------------------------------------------- the objects

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('plan-photos', 'plan-photos', false, 8388608, ARRAY['image/jpeg'])
ON CONFLICT (id) DO NOTHING;

-- The first path segment is the plan. A client is free to upload to a path
-- shaped however it likes, so the cast has to survive garbage: a policy that
-- raises on `notauuid/x.jpg` is an error where a refusal was wanted, and the
-- difference is visible to whoever sent it. NULL flows through the predicates
-- below as false, which is the refusal.
CREATE OR REPLACE FUNCTION public.plan_photo_plan_id(p_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SET search_path = public, storage
AS $$
BEGIN
  RETURN (storage.foldername(p_name))[1]::UUID;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.plan_photo_plan_id(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.plan_photo_plan_id(TEXT) TO authenticated;

CREATE POLICY "Plan members can add plan photos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'plan-photos'
  AND public.can_add_plan_photo(public.plan_photo_plan_id(name))
);

CREATE POLICY "Group members can view plan photos"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'plan-photos'
  AND public.can_view_plan_photos(public.plan_photo_plan_id(name))
);

-- `owner` is set by the Storage API to whoever uploaded, which is the same
-- test the table's DELETE policy makes and needs no path parsing to reach.
CREATE POLICY "Uploaders can remove their own plan photos"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'plan-photos'
  AND owner = auth.uid()
);

-- ------------------------------------------------------------------- realtime
--
-- Same publication PLA-28 set up in 20260802000004. RLS still decides what
-- each subscriber actually receives, so a table-wide listener delivers a
-- photo only to people the SELECT policy above would have shown it to, and a
-- blocked uploader's photo never reaches the person who blocked them.

ALTER PUBLICATION supabase_realtime ADD TABLE public.plan_photos;

-- ------------------------------------------------------------------ reporting
--
-- A word list cannot read a photograph. Guideline 1.2 wants a way to flag
-- objectionable content whatever form it takes, so for images report-and-block
-- is not the backstop, it is the whole mechanism, and it needs its own subject
-- type: reporting the plan instead would tell whoever reads it nothing about
-- which of forty photos was the problem.

ALTER TABLE public.content_reports
  DROP CONSTRAINT IF EXISTS content_reports_subject_type_check;

ALTER TABLE public.content_reports
  ADD CONSTRAINT content_reports_subject_type_check
  CHECK (subject_type IN ('plan', 'group', 'profile', 'photo'));
