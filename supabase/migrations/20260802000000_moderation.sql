-- Moderation — App Store Review Guideline 1.2.
--
-- Planazo carries user-generated content: group names, plan titles and
-- descriptions, locations, display names, profile photos. Apple asks a UGC app
-- for a way to report content, a way to block the person behind it, published
-- contact details, and terms saying what is not allowed. The last two live on
-- planazo.me (/support and /terms). This migration is the first two.
--
-- It is deliberately small. There is no discovery and no public feed here —
-- everything happens inside a private, invite-only group — so the job is to
-- give somebody a way out of a group member who has turned unpleasant, and to
-- give us a queue to act on.

-- ----------------------------------------------------------------- reports

CREATE TABLE public.content_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Detached rather than deleted when the reporter closes their account: the
  -- report is evidence about somebody else, and it should not evaporate
  -- because the person who filed it left. Nothing personal survives — the
  -- profile it pointed at is gone with the row.
  reporter_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Polymorphic on purpose: no FK, so a report outlives the plan or group it
  -- describes. Deleting the evidence the moment somebody deletes the offending
  -- plan is exactly the wrong behaviour.
  subject_type TEXT NOT NULL CHECK (subject_type IN ('plan', 'group', 'profile')),
  subject_id UUID NOT NULL,
  reason TEXT NOT NULL CHECK (
    reason IN ('harassment', 'hate', 'sexual', 'violence', 'spam', 'other')
  ),
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.content_reports ENABLE ROW LEVEL SECURITY;

-- Write-only from the app, the same shape as feedback. A reporter files and
-- never reads back, which means the reported party has no way to discover who
-- reported them. Triage happens off the service role.
CREATE POLICY "Users can file their own reports"
  ON public.content_reports FOR INSERT
  TO authenticated
  WITH CHECK (reporter_id = auth.uid());

CREATE INDEX content_reports_subject_idx
  ON public.content_reports (subject_type, subject_id, created_at DESC);

-- ------------------------------------------------------------------ blocks

CREATE TABLE public.blocked_users (
  blocker_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT blocked_users_not_self CHECK (blocker_id <> blocked_id)
);

ALTER TABLE public.blocked_users ENABLE ROW LEVEL SECURITY;

-- Only the blocker can read their own list. Without this the blocked party
-- could query the table and learn they had been blocked, which is the one
-- thing a block must not announce.
CREATE POLICY "Users can see their own blocks"
  ON public.blocked_users FOR SELECT
  TO authenticated
  USING (blocker_id = auth.uid());

CREATE POLICY "Users can block for themselves"
  ON public.blocked_users FOR INSERT
  TO authenticated
  WITH CHECK (blocker_id = auth.uid());

CREATE POLICY "Users can unblock for themselves"
  ON public.blocked_users FOR DELETE
  TO authenticated
  USING (blocker_id = auth.uid());

-- SECURITY DEFINER so that calling this from another table's policy does not
-- re-enter blocked_users' own RLS — the same reason is_group_member exists.
CREATE OR REPLACE FUNCTION public.has_blocked(p_target UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_target IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.blocked_users
    WHERE blocker_id = auth.uid() AND blocked_id = p_target
  );
$$;

REVOKE ALL ON FUNCTION public.has_blocked(UUID) FROM public;
GRANT EXECUTE ON FUNCTION public.has_blocked(UUID) TO authenticated;

-- Blocking has to bite somewhere real or it is a button that lies. The honest
-- place is here: block someone and the plans they posted stop being visible to
-- you — in the feed, in a group, and by direct link alike, because it is the
-- row that disappears rather than a filter someone forgot to apply.
--
-- Their membership is untouched. Removing a member is an admin's decision and
-- blocking is a personal one, so a block never quietly reshapes the group for
-- everybody else. Anyone who has blocked nobody sees exactly what they saw
-- before: has_blocked() short-circuits on an empty table.
DROP POLICY IF EXISTS "Group members can view plans" ON public.plans;
CREATE POLICY "Group members can view plans"
  ON public.plans FOR SELECT
  TO authenticated
  USING (
    public.is_group_member(group_id)
    AND NOT public.has_blocked(created_by)
  );
