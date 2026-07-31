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
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_group record;
  v_heir uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '28000';
  END IF;

  -- Hand every group this account created to its longest-standing other
  -- member, promoting them so the group keeps someone who can manage it.
  FOR v_group IN SELECT id FROM public.groups WHERE created_by = v_uid LOOP
    SELECT gm.user_id
      INTO v_heir
      FROM public.group_members gm
     WHERE gm.group_id = v_group.id
       AND gm.user_id <> v_uid
     ORDER BY gm.joined_at ASC, gm.id ASC
     LIMIT 1;

    IF v_heir IS NULL THEN
      -- Nobody else was ever in it, so there is no evening to protect.
      -- Plans, options, RSVPs and availability go with the group.
      DELETE FROM public.groups WHERE id = v_group.id;
    ELSE
      UPDATE public.group_members
         SET role = 'admin'
       WHERE group_id = v_group.id
         AND user_id = v_heir;

      UPDATE public.groups
         SET created_by = v_heir
       WHERE id = v_group.id;
    END IF;
  END LOOP;

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
  'longest-standing remaining member; plans they posted stay but lose the name.';
