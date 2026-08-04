-- PLA-56: the album downloads far more than it shows.
--
-- PLA-32 answered the storage cost by downscaling every upload to 2048px. The
-- read side never got the same attention: an 85pt tile on the plan card and a
-- 120pt tile in the album grid both fetch that same ~500KB original, so
-- scrolling a full album is ~100MB of transfer to fill squares.
--
-- The fix is a second, ~512px rendition written at upload time, and this is
-- its column. The path (`<plan>/<uploader>/<key>_thumb.jpg`) keeps the same
-- first two segments as the original, so every storage policy in
-- 20260803000002 applies to it unchanged and no policy work happens here.
--
-- Nullable, because NULL is a real state with a defined meaning: the client
-- falls back to signing the original. Photos uploaded before this migration
-- have no rendition, and a source already at or under thumbnail size never
-- gets one (re-encoding it would cost quality to save nothing).
--
-- UNIQUE for the same reason storage_path is: the key is client-generated, so
-- a collision becomes a failed insert rather than one photo's tile silently
-- pointing at another's. NULLs never collide in a unique index, so the
-- fallback rows are unaffected.

ALTER TABLE public.plan_photos
  ADD COLUMN thumb_path TEXT UNIQUE;
