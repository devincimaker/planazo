-- PLA-56, part two: the plan-detail card was paying full-album cost.
--
-- The card shows four tiles and one sentence, and to get them it fetched
-- every row with a profiles join and signed every path: ~135KB and two round
-- trips before a single pixel, on every open of any past plan. This function
-- is the whole answer shaped server-side: three counts, one name, and the
-- newest four paths. The card never needs row five onward.
--
-- Deliberately **not** SECURITY DEFINER, unlike every other function the
-- album has. Those are called *from* RLS policies and must not re-enter RLS;
-- this one is called *by* the client and must. Running as the caller means
-- the plan_photos SELECT policy decides what is countable — a non-member
-- gets an empty album, not an error, and a blocked uploader's photos vanish
-- from the counts the same way they vanish from the grid. The profiles read
-- rides the same rule: it joins only rows the SELECT policy already let
-- through.
--
-- `mine` counts by auth.uid() rather than taking a user id as an argument,
-- so the function cannot be asked about somebody else's share.

CREATE OR REPLACE FUNCTION public.plan_album_card(p_plan_id UUID)
RETURNS TABLE (
  total INTEGER,
  mine INTEGER,
  uploaders INTEGER,
  -- The newest four, newest first: id, storage_path, thumb_path,
  -- uploader_name. JSONB rather than columns per slot, because the shape is
  -- a list. The uploader's name rides on each slot so the sentence ("12
  -- photos from Alex" leads with the newest photo's uploader) is read off
  -- recent[0] client-side: one ordered scan, and the sentence and the strip
  -- cannot disagree about which photo is newest.
  recent JSONB
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH visible AS (
    SELECT id, uploaded_by, storage_path, thumb_path, created_at
    FROM public.plan_photos
    WHERE plan_id = p_plan_id
  )
  SELECT
    COUNT(*)::INTEGER,
    (COUNT(*) FILTER (WHERE v.uploaded_by = auth.uid()))::INTEGER,
    COUNT(DISTINCT v.uploaded_by)::INTEGER,
    (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', s.id,
            'storage_path', s.storage_path,
            'thumb_path', s.thumb_path,
            'uploader_name', s.display_name
          )
          ORDER BY s.created_at DESC
        ),
        '[]'::jsonb
      )
      FROM (
        SELECT n.id, n.storage_path, n.thumb_path, n.created_at, pr.display_name
        FROM visible n
        LEFT JOIN public.profiles pr ON pr.id = n.uploaded_by
        ORDER BY n.created_at DESC
        LIMIT 4
      ) s
    )
  FROM visible v;
$$;

REVOKE ALL ON FUNCTION public.plan_album_card(UUID) FROM public;
GRANT EXECUTE ON FUNCTION public.plan_album_card(UUID) TO authenticated;
