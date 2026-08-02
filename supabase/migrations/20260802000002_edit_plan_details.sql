-- PLA-31: the host can fix a plan's title, place and notes.
--
-- The permission was never the missing piece. 20241229000001 already granted
-- UPDATE on plans to the creator or a group admin — the same pair the plan
-- screen calls "host". What was missing is a bound on WHICH COLUMNS that
-- permission covers.
--
-- RLS is row-level, and only row-level. "Creator and admins can update plans"
-- draws no distinction between fixing a typo and this:
--
--   PATCH /rest/v1/plans?id=eq.<id>   {"status": "cancelled"}
--
-- which is a cancellation that never ran cancel_plan, so nobody who was going
-- is ever told. Or {"group_id": "<another circle>"}, which moves the plan into
-- a group the host may not even be in: the row still satisfies
-- `created_by = auth.uid()`, so the policy waves it through.
--
-- Two rules, one per axis: the policy picks the row, a column-level GRANT
-- picks the columns. No new RPC — this is a plain data edit, the same shape as
-- renaming a group, and SECURITY DEFINER stays reserved for the writes a
-- member genuinely may not make for themselves (seating people at a lock,
-- writing notifications addressed to somebody else).


-- 1. Which rows --------------------------------------------------------------
--
-- The same host test as before, plus: a cancelled plan is out of reach. The
-- stone card on a called-off plan is a record of what was called off, and
-- retitling it afterwards rewrites that under everyone who already read it.
-- Reopen it first (restore_plan), then edit.
--
-- WITH CHECK is omitted deliberately. Postgres defaults it to the USING
-- expression for UPDATE, and none of title/location/description appears in
-- that expression, so the row passes exactly the same test after the write as
-- it did before.
DROP POLICY IF EXISTS "Creator and admins can update plans" ON public.plans;

CREATE POLICY "Host can edit a live plan"
  ON public.plans FOR UPDATE
  TO authenticated
  USING (
    (created_by = auth.uid() OR public.is_group_admin(group_id))
    AND status <> 'cancelled'
  );


-- 2. Which columns -----------------------------------------------------------
--
-- Supabase's default privileges hand `authenticated` UPDATE on every column of
-- every table in `public`. Narrow that to the three the edit screen offers.
-- Everything else — status, min_people, max_people, group_id, locked_date,
-- created_by — now answers 42501 insufficient_privilege, which the app already
-- reads (isForbiddenError, apps/mobile/lib/queryErrors.ts). Loud, not silent.
--
-- Three things this looks like it should break and does not, each worth saying
-- out loud:
--
--   * The lifecycle RPCs. lock_plan, reopen_plan, cancel_plan and restore_plan
--     are SECURITY DEFINER — they run as this table's owner, so they go on
--     writing status, locked_date, cancelled_by and the rest. After this
--     migration they are the ONLY way those columns ever change.
--   * The updated_at trigger. Column privileges are checked against the
--     columns named in the statement, not against what a BEFORE trigger does
--     to NEW.
--   * service_role. A separate grantee, untouched — the integration testbed's
--     setup and teardown keep working.
--
-- One consequence to carry forward: column grants do not extend to columns
-- added later. A future ALTER TABLE ... ADD COLUMN is unwritable from the
-- client until it is granted here too. That is the right default — it fails
-- closed — and it will still surprise somebody.
REVOKE UPDATE ON public.plans FROM authenticated, anon;
GRANT UPDATE (title, location, description) ON public.plans TO authenticated;
