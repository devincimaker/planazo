-- PLA-30 — a group can have a photo, and the letter tile stays the default.
--
-- Groups have been identified by a letter on a coloured tile since
-- 20260729000000_groups_color_prefs.sql. That colour stays load-bearing: the
-- feed's card stripe (apps/mobile/components/ui/Card.tsx) and the group dots
-- in plan/create.tsx have nowhere to put a photo, so `color` keeps doing that
-- job everywhere a tile does not fit. This migration layers an optional photo
-- on top of the colour system rather than replacing it, so a group with no
-- photo looks exactly as it does today.
--
-- 1. groups.image_url  — the photo, or NULL for "use the letter"
-- 2. group-images      — a public bucket, one folder per group
-- 3. storage policies  — only group admins write, anyone with the URL reads


-- 1. The column ---------------------------------------------------------------
--
-- The full public URL with a cache-busting query, not a bare storage path.
-- That matches profiles.avatar_url and how profile/edit.tsx writes it:
-- replacing a photo reuses the same object name, so without the ?t= suffix the
-- old image stays on screen until the CDN cache expires.
ALTER TABLE public.groups ADD COLUMN image_url TEXT;

-- Nothing to grant. `groups` has no column-level GRANTs and its UPDATE policy
-- is is_group_admin(id) (20241229000001_fix_rls_recursion.sql), so admins can
-- write image_url and ordinary members cannot, for free.


-- 2. The bucket ---------------------------------------------------------------
--
-- Public, like `avatars` (20241229000007_add_avatars_bucket.sql), and unlike
-- the private `feedback-screenshots` (20260729000003_feedback.sql). Private
-- would mean a signed URL per group per render, with expiry and cache handling
-- on every screen that shows a tile, to protect a photo the members already
-- share with each other. The object name carries the group's UUID, so the URL
-- is not guessable.
INSERT INTO storage.buckets (id, name, public)
VALUES ('group-images', 'group-images', true)
ON CONFLICT (id) DO NOTHING;


-- 3. Storage policies ---------------------------------------------------------
--
-- Both existing buckets are user-owned, so their policies compare the first
-- path segment to auth.uid() directly. A group photo is group-owned, at
-- `<group_id>/cover.jpg`, which means casting that segment to a UUID — and an
-- object named `hello/cover.jpg` would raise 22P02 on the cast rather than
-- simply failing the check. So the cast is guarded, and anything that is not a
-- UUID is just "not an admin".
CREATE OR REPLACE FUNCTION public.is_group_image_admin(object_name TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  v_folder TEXT;
BEGIN
  v_folder := (storage.foldername(object_name))[1];
  IF v_folder IS NULL OR v_folder !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RETURN FALSE;
  END IF;
  RETURN public.is_group_admin(v_folder::uuid);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, storage;

REVOKE ALL ON FUNCTION public.is_group_image_admin(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_group_image_admin(TEXT) TO authenticated;

DROP POLICY IF EXISTS "Group admins can upload a group photo" ON storage.objects;
CREATE POLICY "Group admins can upload a group photo"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'group-images' AND
  public.is_group_image_admin(name)
);

-- Replacing a photo reuses the object name, so an upsert lands here and not on
-- INSERT. WITH CHECK as well as USING: an admin may overwrite their own group's
-- photo, not rename it into another group's folder.
DROP POLICY IF EXISTS "Group admins can replace a group photo" ON storage.objects;
CREATE POLICY "Group admins can replace a group photo"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'group-images' AND
  public.is_group_image_admin(name)
)
WITH CHECK (
  bucket_id = 'group-images' AND
  public.is_group_image_admin(name)
);

DROP POLICY IF EXISTS "Group admins can remove a group photo" ON storage.objects;
CREATE POLICY "Group admins can remove a group photo"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'group-images' AND
  public.is_group_image_admin(name)
);

DROP POLICY IF EXISTS "Anyone can view group photos" ON storage.objects;
CREATE POLICY "Anyone can view group photos"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'group-images');
