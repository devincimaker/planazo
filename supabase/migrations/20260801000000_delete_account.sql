-- Account deletion, required by App Store Review Guideline 5.1.1(v): an app
-- that lets you create an account must let you delete it from inside the app.
--
-- Everything personal already cascades off auth.users. Three columns did not,
-- and they are the reason a delete would have failed outright:
--
--   groups.created_by   NOT NULL, no ON DELETE  -> blocks the delete
--   plans.created_by    NOT NULL, no ON DELETE  -> blocks the delete
--   plans.cancelled_by  nullable, no ON DELETE  -> blocks the delete
--
-- The rule we want is "your name goes, the group's evening stays": a group you
-- made passes to whoever has been in it longest, and a plan you posted keeps
-- its answers but stops carrying your name. So these become SET NULL, and the
-- hand-over happens in the RPC below before the row disappears.

-- 1. A creator may now be absent ------------------------------------------------

ALTER TABLE public.groups ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.plans  ALTER COLUMN created_by DROP NOT NULL;

ALTER TABLE public.groups DROP CONSTRAINT groups_created_by_fkey;
ALTER TABLE public.groups
  ADD CONSTRAINT groups_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.plans DROP CONSTRAINT plans_created_by_fkey;
ALTER TABLE public.plans
  ADD CONSTRAINT plans_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.plans DROP CONSTRAINT plans_cancelled_by_fkey;
ALTER TABLE public.plans
  ADD CONSTRAINT plans_cancelled_by_fkey
  FOREIGN KEY (cancelled_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Every RLS policy that mentions created_by compares it to auth.uid(), which is
-- false rather than broken when the column is null, and each one already falls
-- back to is_group_admin(). That is what makes the hand-over below sufficient:
-- the new admin can still lock, cancel and reopen the plans they inherited.

-- 2. Delete the signed-in account ----------------------------------------------

CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, storage
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_group record;
  v_heir uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '28000';
  END IF;

  -- Every group this account could strand: the ones it created, and the ones
  -- it only belongs to. Both matter, because admin is a role that gets granted
  -- and revoked (group/[id]/manage.tsx lets any admin promote or demote), so
  -- the last admin standing is frequently not the creator.
  FOR v_group IN
    SELECT g.id, g.created_by
      FROM public.groups g
     WHERE g.created_by = v_uid
        OR EXISTS (
             SELECT 1
               FROM public.group_members gm
              WHERE gm.group_id = g.id
                AND gm.user_id = v_uid
           )
  LOOP
    -- An existing admin first, then length of service. Ordering by join date
    -- alone would hand the group to a plain member over somebody already
    -- trusted to run it, and leave the new owner unable to manage it.
    SELECT gm.user_id
      INTO v_heir
      FROM public.group_members gm
     WHERE gm.group_id = v_group.id
       AND gm.user_id <> v_uid
     ORDER BY (gm.role = 'admin') DESC, gm.joined_at ASC, gm.id ASC
     LIMIT 1;

    IF v_heir IS NULL THEN
      -- Nobody else is in it, so there is no evening to protect — unless it
      -- still has a living creator who isn't us. They can see it under the
      -- groups SELECT policy, which makes it theirs and not ours to delete.
      IF v_group.created_by IS NULL OR v_group.created_by = v_uid THEN
        DELETE FROM public.groups WHERE id = v_group.id;
      END IF;
    ELSE
      IF v_group.created_by = v_uid THEN
        UPDATE public.groups
           SET created_by = v_heir
         WHERE id = v_group.id;
      END IF;

      -- Leave at least one admin behind. Only promote when our leaving would
      -- take the last one, so a group that is already fine is never re-ranked.
      IF NOT EXISTS (
        SELECT 1
          FROM public.group_members
         WHERE group_id = v_group.id
           AND user_id <> v_uid
           AND role = 'admin'
      ) THEN
        UPDATE public.group_members
           SET role = 'admin'
         WHERE group_id = v_group.id
           AND user_id = v_heir;
      END IF;
    END IF;
  END LOOP;

  -- Storage is deliberately NOT cleaned up here. Files are not rows: deleting
  -- auth.users never touches them, and Supabase guards storage.objects with a
  -- protect_delete() trigger that raises on any direct DELETE, SECURITY
  -- DEFINER included. The only sanctioned route is the Storage API, so the
  -- client empties both buckets before it calls this function — see
  -- lib/storage.ts and the policies added below, which are what let it.

  -- The profile row cascades from auth.users, and from the profile so do the
  -- memberships, RSVPs, availability, invites, friendships, notifications and
  -- feedback. Plans this account posted stay in their group with created_by
  -- set to null.
  DELETE FROM auth.users WHERE id = v_uid;
END;
$$;

-- Only a signed-in caller, and only ever their own account: the function reads
-- auth.uid() itself and takes no arguments, so there is nothing to point at
-- somebody else.
REVOKE ALL ON FUNCTION public.delete_my_account() FROM public;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;

COMMENT ON FUNCTION public.delete_my_account() IS
  'Deletes the calling user''s account. Groups they created pass to the '
  'longest-standing remaining member; plans they posted stay but lose the name. '
  'Storage is the caller''s job — see lib/storage.ts.';

-- 3. Let people clear their own files ------------------------------------------

-- The avatars bucket already allows an owner to list and delete their folder.
-- feedback-screenshots only ever allowed INSERT, so a user could add evidence
-- and never take it back — which also made deleting the account leave their
-- screenshots sitting in the bucket. Both verbs, own folder only; the bucket
-- stays private, so this is not a read grant to anybody else.

DROP POLICY IF EXISTS "Users can see their own feedback screenshots" ON storage.objects;
CREATE POLICY "Users can see their own feedback screenshots"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'feedback-screenshots' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Users can delete their own feedback screenshots" ON storage.objects;
CREATE POLICY "Users can delete their own feedback screenshots"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'feedback-screenshots' AND
  (storage.foldername(name))[1] = auth.uid()::text
);
