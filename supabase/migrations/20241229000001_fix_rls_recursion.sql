-- Fix RLS infinite recursion on group_members table
-- The original policies query group_members to check membership, causing recursion

-- Create SECURITY DEFINER functions that bypass RLS to check membership

-- Check if user is a member of a group
CREATE OR REPLACE FUNCTION public.is_group_member(check_group_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = check_group_id AND user_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Check if user is an admin of a group
CREATE OR REPLACE FUNCTION public.is_group_admin(check_group_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = check_group_id AND user_id = auth.uid() AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Drop existing problematic policies
DROP POLICY IF EXISTS "Group members can view memberships" ON public.group_members;
DROP POLICY IF EXISTS "Admins can update memberships" ON public.group_members;
DROP POLICY IF EXISTS "Members can leave (delete own) or admins can kick" ON public.group_members;

-- Also update policies on other tables that reference group_members
DROP POLICY IF EXISTS "Group members can view their groups" ON public.groups;
DROP POLICY IF EXISTS "Group admins can update their groups" ON public.groups;
DROP POLICY IF EXISTS "Group admins can delete their groups" ON public.groups;
DROP POLICY IF EXISTS "Group members can view plans" ON public.plans;
DROP POLICY IF EXISTS "Group members can create plans" ON public.plans;
DROP POLICY IF EXISTS "Creator and admins can update plans" ON public.plans;
DROP POLICY IF EXISTS "Creator and admins can delete plans" ON public.plans;
DROP POLICY IF EXISTS "Group members can view date options" ON public.plan_date_options;
DROP POLICY IF EXISTS "Group members can view RSVPs" ON public.rsvps;
DROP POLICY IF EXISTS "Group members can view availability" ON public.date_availability;

-- ============================================
-- NEW POLICIES USING SECURITY DEFINER FUNCTIONS
-- ============================================

-- GROUP_MEMBERS POLICIES
-- Users can see their own membership + memberships in groups they belong to
CREATE POLICY "Users can view memberships in their groups"
  ON public.group_members FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid() OR public.is_group_member(group_id)
  );

CREATE POLICY "Admins can update memberships"
  ON public.group_members FOR UPDATE
  TO authenticated
  USING (public.is_group_admin(group_id));

CREATE POLICY "Members can leave or admins can kick"
  ON public.group_members FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid() OR public.is_group_admin(group_id)
  );

-- GROUPS POLICIES (using helper functions)
CREATE POLICY "Group members can view their groups"
  ON public.groups FOR SELECT
  TO authenticated
  USING (public.is_group_member(id));

CREATE POLICY "Group admins can update their groups"
  ON public.groups FOR UPDATE
  TO authenticated
  USING (public.is_group_admin(id));

CREATE POLICY "Group admins can delete their groups"
  ON public.groups FOR DELETE
  TO authenticated
  USING (public.is_group_admin(id));

-- PLANS POLICIES (using helper functions)
CREATE POLICY "Group members can view plans"
  ON public.plans FOR SELECT
  TO authenticated
  USING (public.is_group_member(group_id));

CREATE POLICY "Group members can create plans"
  ON public.plans FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_group_member(group_id) AND created_by = auth.uid()
  );

CREATE POLICY "Creator and admins can update plans"
  ON public.plans FOR UPDATE
  TO authenticated
  USING (
    created_by = auth.uid() OR public.is_group_admin(group_id)
  );

CREATE POLICY "Creator and admins can delete plans"
  ON public.plans FOR DELETE
  TO authenticated
  USING (
    created_by = auth.uid() OR public.is_group_admin(group_id)
  );

-- PLAN_DATE_OPTIONS POLICIES
CREATE POLICY "Group members can view date options"
  ON public.plan_date_options FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.plans p
      WHERE p.id = plan_date_options.plan_id AND public.is_group_member(p.group_id)
    )
  );

-- RSVPS POLICIES
CREATE POLICY "Group members can view RSVPs"
  ON public.rsvps FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.plans p
      WHERE p.id = rsvps.plan_id AND public.is_group_member(p.group_id)
    )
  );

-- DATE_AVAILABILITY POLICIES
CREATE POLICY "Group members can view availability"
  ON public.date_availability FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.plans p
      WHERE p.id = date_availability.plan_id AND public.is_group_member(p.group_id)
    )
  );
