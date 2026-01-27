-- Friends and Groupless Plans Migration
-- Adds:
-- 1. Friendships table for mutual friend relationships
-- 2. Plan invites table for groupless plans
-- 3. Makes plans.group_id nullable
-- 4. New notification types
-- 5. Helper functions and RLS policies

-- ============================================
-- NEW TABLES
-- ============================================

-- Friendships table for mutual friend relationships
CREATE TABLE public.friendships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  addressee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted')) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  -- Ensure no duplicate requests (either direction handled in app logic)
  CONSTRAINT unique_friendship UNIQUE (requester_id, addressee_id),
  -- Prevent self-friendship
  CONSTRAINT no_self_friendship CHECK (requester_id != addressee_id)
);

-- Plan invites table for groupless plans
CREATE TABLE public.plan_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  invited_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(plan_id, user_id)
);

-- ============================================
-- TABLE MODIFICATIONS
-- ============================================

-- Make group_id nullable on plans table to support groupless plans
ALTER TABLE public.plans ALTER COLUMN group_id DROP NOT NULL;

-- Update notifications type constraint to include new types
ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'plan_created',
    'plan_locked',
    'plan_cancelled',
    'invited_to_group',
    'kicked_from_group',
    'friend_request',
    'friend_accepted',
    'plan_invite'
  ));

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX idx_friendships_requester ON public.friendships(requester_id);
CREATE INDEX idx_friendships_addressee ON public.friendships(addressee_id);
CREATE INDEX idx_friendships_status ON public.friendships(status);
CREATE INDEX idx_plan_invites_plan ON public.plan_invites(plan_id);
CREATE INDEX idx_plan_invites_user ON public.plan_invites(user_id);
CREATE INDEX idx_plans_groupless ON public.plans(id) WHERE group_id IS NULL;

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Check if two users are friends (accepted friendship)
CREATE OR REPLACE FUNCTION public.are_friends(user1 UUID, user2 UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.friendships
    WHERE status = 'accepted'
    AND (
      (requester_id = user1 AND addressee_id = user2)
      OR (requester_id = user2 AND addressee_id = user1)
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Check if user can see a plan (for groupless plans support)
CREATE OR REPLACE FUNCTION public.can_see_plan(check_plan_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  plan_group_id UUID;
  plan_creator UUID;
BEGIN
  SELECT group_id, created_by INTO plan_group_id, plan_creator
  FROM public.plans WHERE id = check_plan_id;

  -- If plan has a group, use group membership
  IF plan_group_id IS NOT NULL THEN
    RETURN public.is_group_member(plan_group_id);
  END IF;

  -- Groupless plan: creator can always see
  IF plan_creator = auth.uid() THEN
    RETURN TRUE;
  END IF;

  -- Groupless plan: invited users can see
  RETURN EXISTS (
    SELECT 1 FROM public.plan_invites
    WHERE plan_id = check_plan_id AND user_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================
-- ENABLE RLS ON NEW TABLES
-- ============================================

ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_invites ENABLE ROW LEVEL SECURITY;

-- ============================================
-- FRIENDSHIPS RLS POLICIES
-- ============================================

-- Users can view their own friendship records (sent or received)
CREATE POLICY "Users can view own friendships"
  ON public.friendships FOR SELECT
  TO authenticated
  USING (requester_id = auth.uid() OR addressee_id = auth.uid());

-- Users can send friend requests
CREATE POLICY "Users can send friend requests"
  ON public.friendships FOR INSERT
  TO authenticated
  WITH CHECK (requester_id = auth.uid() AND status = 'pending');

-- Addressee can accept friend requests
CREATE POLICY "Addressee can accept friend requests"
  ON public.friendships FOR UPDATE
  TO authenticated
  USING (addressee_id = auth.uid() AND status = 'pending');

-- Users can delete their own friendship records
-- (requester can cancel pending, either party can unfriend)
CREATE POLICY "Users can delete own friendships"
  ON public.friendships FOR DELETE
  TO authenticated
  USING (requester_id = auth.uid() OR addressee_id = auth.uid());

-- ============================================
-- PLAN INVITES RLS POLICIES
-- ============================================

-- Users can see invites for plans they can see
CREATE POLICY "Users can view plan invites"
  ON public.plan_invites FOR SELECT
  TO authenticated
  USING (public.can_see_plan(plan_id));

-- Plan creators can invite users to their groupless plans
CREATE POLICY "Creators can invite to groupless plans"
  ON public.plan_invites FOR INSERT
  TO authenticated
  WITH CHECK (
    invited_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.plans
      WHERE id = plan_id
      AND created_by = auth.uid()
      AND group_id IS NULL
    )
  );

-- Plan creators can remove invites
CREATE POLICY "Creators can remove invites"
  ON public.plan_invites FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.plans
      WHERE id = plan_id
      AND created_by = auth.uid()
    )
  );

-- ============================================
-- UPDATE PLANS RLS POLICIES FOR GROUPLESS SUPPORT
-- ============================================

-- Drop existing plan policies
DROP POLICY IF EXISTS "Group members can view plans" ON public.plans;
DROP POLICY IF EXISTS "Group members can create plans" ON public.plans;
DROP POLICY IF EXISTS "Creator and admins can update plans" ON public.plans;
DROP POLICY IF EXISTS "Creator and admins can delete plans" ON public.plans;

-- View plans: group members OR invited to groupless plan OR creator
CREATE POLICY "Users can view accessible plans"
  ON public.plans FOR SELECT
  TO authenticated
  USING (public.can_see_plan(id));

-- Create plans: group members for group plans, anyone for groupless
CREATE POLICY "Users can create plans"
  ON public.plans FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND (
      group_id IS NULL  -- groupless plan
      OR public.is_group_member(group_id)  -- group plan
    )
  );

-- Update plans: creator or group admin
CREATE POLICY "Creators and admins can update plans"
  ON public.plans FOR UPDATE
  TO authenticated
  USING (
    created_by = auth.uid()
    OR (group_id IS NOT NULL AND public.is_group_admin(group_id))
  );

-- Delete plans: creator or group admin
CREATE POLICY "Creators and admins can delete plans"
  ON public.plans FOR DELETE
  TO authenticated
  USING (
    created_by = auth.uid()
    OR (group_id IS NOT NULL AND public.is_group_admin(group_id))
  );

-- ============================================
-- UPDATE RELATED TABLES FOR GROUPLESS SUPPORT
-- ============================================

-- Update plan_date_options policies
DROP POLICY IF EXISTS "Group members can view date options" ON public.plan_date_options;
CREATE POLICY "Users can view date options for accessible plans"
  ON public.plan_date_options FOR SELECT
  TO authenticated
  USING (public.can_see_plan(plan_id));

-- Update RSVPs policies
DROP POLICY IF EXISTS "Group members can view RSVPs" ON public.rsvps;
CREATE POLICY "Users can view RSVPs for accessible plans"
  ON public.rsvps FOR SELECT
  TO authenticated
  USING (public.can_see_plan(plan_id));

-- Update RSVP insert policy to allow plan participants
DROP POLICY IF EXISTS "Users can manage own RSVPs on open plans" ON public.rsvps;
CREATE POLICY "Plan participants can RSVP on open plans"
  ON public.rsvps FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.can_see_plan(plan_id)
    AND EXISTS (
      SELECT 1 FROM public.plans
      WHERE id = rsvps.plan_id AND status = 'open'
    )
  );

-- Update RSVP update policy
DROP POLICY IF EXISTS "Users can update own RSVPs on open plans" ON public.rsvps;
CREATE POLICY "Users can update own RSVPs on open plans"
  ON public.rsvps FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND public.can_see_plan(plan_id)
    AND EXISTS (
      SELECT 1 FROM public.plans
      WHERE id = rsvps.plan_id AND status = 'open'
    )
  );

-- Update date_availability policies
DROP POLICY IF EXISTS "Group members can view availability" ON public.date_availability;
CREATE POLICY "Users can view availability for accessible plans"
  ON public.date_availability FOR SELECT
  TO authenticated
  USING (public.can_see_plan(plan_id));

-- Update date_availability insert policy
DROP POLICY IF EXISTS "Users can manage own availability on open plans" ON public.date_availability;
CREATE POLICY "Plan participants can manage availability on open plans"
  ON public.date_availability FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.can_see_plan(plan_id)
    AND EXISTS (
      SELECT 1 FROM public.plans
      WHERE id = date_availability.plan_id AND status = 'open'
    )
  );

-- Update date_availability update policy
DROP POLICY IF EXISTS "Users can update own availability on open plans" ON public.date_availability;
CREATE POLICY "Users can update own availability on open plans"
  ON public.date_availability FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND public.can_see_plan(plan_id)
    AND EXISTS (
      SELECT 1 FROM public.plans
      WHERE id = date_availability.plan_id AND status = 'open'
    )
  );
