-- PLA-16: an RSVP could never be cleared.
--
-- rsvps had INSERT/UPDATE/SELECT policies but no DELETE policy at all, so
-- every "Change" in the app deleted zero rows. RLS filters the row out rather
-- than raising, PostgREST answers 200 with no rows, and the client redraws the
-- same state — a silent dead button on every answered plan.
--
-- The INSERT and UPDATE policies were also scoped to status = 'open', which
-- froze anyone the lock seeded into a 'yes' (see 20260728000002): the group
-- votes on dates, the host locks it, and nobody who was available can drop
-- out — precisely when a real-life clash surfaces.
--
-- One rule now covers all three verbs: your own row, on a plan that is still
-- live. 'live' means open or locked; cancelled plans are a record and stay
-- frozen. Past plans keep whatever status they had — status carries no notion
-- of time — so the screens, not RLS, decide what a past plan may still do.

-- INSERT: was "Users can manage own RSVPs on open plans"
DROP POLICY IF EXISTS "Users can manage own RSVPs on open plans" ON public.rsvps;
CREATE POLICY "Users can insert own RSVPs on live plans"
  ON public.rsvps FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.plans
      WHERE id = rsvps.plan_id AND status IN ('open', 'locked')
    )
  );

-- UPDATE: was "Users can update own RSVPs on open plans".
-- No WITH CHECK, so Postgres reuses USING for the new row too — which is what
-- we want: you may not move your row onto another plan or another user.
DROP POLICY IF EXISTS "Users can update own RSVPs on open plans" ON public.rsvps;
CREATE POLICY "Users can update own RSVPs on live plans"
  ON public.rsvps FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.plans
      WHERE id = rsvps.plan_id AND status IN ('open', 'locked')
    )
  );

-- DELETE: new. Withdrawing is the one thing that must survive a lock.
CREATE POLICY "Users can delete own RSVPs on live plans"
  ON public.rsvps FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.plans
      WHERE id = rsvps.plan_id AND status IN ('open', 'locked')
    )
  );
