-- PLA-47: a plan can carry one open question the group votes on.
--
-- Planazo can decide when; this is the first step toward deciding what. The
-- host writes a question and its options, everyone gets one vote, the host
-- closes it, and the answer lands on the plan.
--
-- Deliberately NOT a third plan type. plan_date_options already does voting,
-- but generalising it would leave a plan with exactly one undecided thing,
-- and the motivating case has two: Saturday settled, film TBD. So the poll is
-- a separate object hanging off the plan, and it must coexist with a locked
-- date. Two consequences fall out of that split and everything below serves
-- them:
--
--   1. **Voting works on a locked plan.** The date-availability policies
--      require plans.status = 'open', and mirroring them literally would kill
--      voting on exactly the plan this feature exists for (the settled
--      Saturday is a *locked* plan). So every predicate here asks
--      "not cancelled", never "open".
--
--   2. **The poll does not gate confirmation.** A date option winning is the
--      plan; a film winning is a detail of a plan already happening.
--      isPlanConfirmed() in plan-logic.ts knows nothing about polls, and a
--      test there pins it.
--
-- Single choice, not approval. On a short host-written list "Pizza 5,
-- Sushi 3" summing to the group is legible in a way approval totals never
-- are, and an argument about the film implies a preference that approval
-- dissolves into "sure, fine". It is also the reversible direction: the vote
-- is one row per person under UNIQUE (poll_id, user_id), so if PLA-48's open
-- option list ever fragments the tally, relaxing to approval is dropping a
-- constraint. Going the other way would mean deleting people's votes to fit.
--
-- Votes are stored attributed and rendered as counts. The date rows show
-- "4 free" and never faces, so the screen stays consistent, and attribution
-- is the choice that cannot be retrofitted later.
--
-- Cancel and reopen need no poll-specific handling, by construction: a
-- cancelled plan fails every write predicate here and close_plan_poll
-- refuses it, restore_plan makes those predicates pass again, and
-- reopen_plan (the date vote) never touches poll state.

-- ------------------------------------------------------------------ the rows
--
-- All three tables carry plan_id, the way date_availability does. It keeps
-- every policy one join shorter, and it lets the realtime invalidation map
-- name the exact plan instead of falling back to a prefix-wide invalidation.
-- The composite foreign keys below are what keep the denormalisation honest:
-- a vote whose (option, poll, plan) triple disagrees with itself is not
-- expressible.

CREATE TABLE public.plan_polls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- UNIQUE: one open question per plan is the v1 bet. Follow-ups relax this.
  plan_id UUID NOT NULL UNIQUE REFERENCES public.plans(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  -- Unused until PLA-48 lets members add options. The column is free now and
  -- a migration later.
  suggestions_open BOOLEAN NOT NULL DEFAULT false,
  -- The close is server-side (close_plan_poll); clients hold no grant on
  -- these three. closed_by survives account deletion as NULL, like
  -- plans.created_by: "Marta closed it" outlives Marta's account as
  -- "closed", not as a dangling row.
  closed_at TIMESTAMPTZ,
  closed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Redundant with the PK on purpose: the target the options' composite FK
  -- needs to pin poll_id and plan_id to each other.
  UNIQUE (id, plan_id)
);

CREATE TABLE public.plan_poll_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL,
  plan_id UUID NOT NULL,
  label TEXT NOT NULL,
  -- Explicit ordering. The host writes options in one statement, so
  -- created_at gives every row the same transaction timestamp and no
  -- defensible order — the same lesson waitlist_seq learned.
  position INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (poll_id, plan_id)
    REFERENCES public.plan_polls (id, plan_id) ON DELETE CASCADE,
  UNIQUE (poll_id, position),
  -- Two options saying the same thing is a question mis-asked.
  UNIQUE (poll_id, label),
  -- For the votes' composite FK.
  UNIQUE (id, poll_id)
);

CREATE TABLE public.plan_poll_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL,
  plan_id UUID NOT NULL,
  option_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Single choice lives here: one row per person per poll, and changing your
  -- mind is an upsert on this conflict, exactly like an rsvp.
  UNIQUE (poll_id, user_id),
  FOREIGN KEY (poll_id, plan_id)
    REFERENCES public.plan_polls (id, plan_id) ON DELETE CASCADE,
  -- A vote for another poll's option is unrepresentable, not just impolite.
  FOREIGN KEY (option_id, poll_id)
    REFERENCES public.plan_poll_options (id, poll_id) ON DELETE CASCADE
);

-- The winner, recorded at close. Added after the options table exists because
-- the two tables reference each other. SET NULL is belt and braces: the
-- DELETE policies below make removing a voted-on option unreachable for
-- clients anyway.
ALTER TABLE public.plan_polls
  ADD COLUMN winner_option_id UUID
  REFERENCES public.plan_poll_options(id) ON DELETE SET NULL;

-- The detail screen and the feed card both fetch by plan.
CREATE INDEX idx_plan_poll_options_plan ON public.plan_poll_options(plan_id);
CREATE INDEX idx_plan_poll_votes_plan ON public.plan_poll_votes(plan_id);
-- The tally groups by option.
CREATE INDEX idx_plan_poll_votes_option ON public.plan_poll_votes(option_id);

-- ---------------------------------------------------------------- predicates
--
-- After the tables because can_vote_plan_poll's SQL body references
-- plan_polls and is validated at CREATE time. SECURITY DEFINER for the same
-- reason is_group_member and the photo-album predicates are: called from
-- another table's policy, they must not re-enter the RLS of what they read.

-- Who may write the question and its options: the plan's host or a group
-- admin, the same pair lock_plan and cancel_plan answer to, and the same
-- pair the plan screen calls isHost. The cancelled check lives here because
-- every management action dies with the plan.
CREATE OR REPLACE FUNCTION public.can_manage_plan_poll(p_plan_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.plans p
    WHERE p.id = p_plan_id
      AND p.status <> 'cancelled'
      AND (
        p.created_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.group_members gm
          WHERE gm.group_id = p.group_id
            AND gm.user_id = auth.uid()
            AND gm.role = 'admin'
        )
      )
  );
$$;

-- Who may vote: any group member, while the poll is open and the plan is not
-- cancelled. Note what is absent: plans.status = 'open'. A locked plan with a
-- settled date is the primary home of a live poll, not an edge case.
CREATE OR REPLACE FUNCTION public.can_vote_plan_poll(p_poll_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.plan_polls pp
    JOIN public.plans p ON p.id = pp.plan_id
    WHERE pp.id = p_poll_id
      AND pp.closed_at IS NULL
      AND p.status <> 'cancelled'
      AND public.is_group_member(p.group_id)
  );
$$;

REVOKE ALL ON FUNCTION public.can_manage_plan_poll(UUID) FROM public;
REVOKE ALL ON FUNCTION public.can_vote_plan_poll(UUID) FROM public;
GRANT EXECUTE ON FUNCTION public.can_manage_plan_poll(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_vote_plan_poll(UUID) TO authenticated;

-- ---------------------------------------------------------------------- RLS

ALTER TABLE public.plan_polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_poll_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_poll_votes ENABLE ROW LEVEL SECURITY;

-- Reading: the whole group, closed or not. The answer on a closed poll is
-- for everyone, and votes are attributed rows rendered as counts.
CREATE POLICY "Group members can view plan polls"
  ON public.plan_polls FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.plans p
      WHERE p.id = plan_polls.plan_id AND public.is_group_member(p.group_id)
    )
  );

CREATE POLICY "Group members can view poll options"
  ON public.plan_poll_options FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.plans p
      WHERE p.id = plan_poll_options.plan_id AND public.is_group_member(p.group_id)
    )
  );

CREATE POLICY "Group members can view poll votes"
  ON public.plan_poll_votes FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.plans p
      WHERE p.id = plan_poll_votes.plan_id AND public.is_group_member(p.group_id)
    )
  );

-- The poll itself: host writes it, host may fix it while nobody has voted,
-- host may withdraw it while it is open. The no-votes freeze on UPDATE is
-- the typo rule: fixing "Wich film?" is fine until the first vote lands,
-- after which swapping the question under people's votes is the same UPDATE
-- and the answer to both is no. Withdrawing the whole question stays
-- possible — removal is honest where alteration is not.
CREATE POLICY "Hosts can add a poll"
  ON public.plan_polls FOR INSERT
  TO authenticated
  WITH CHECK (public.can_manage_plan_poll(plan_id));

CREATE POLICY "Hosts can edit an unvoted open poll"
  ON public.plan_polls FOR UPDATE
  TO authenticated
  USING (
    public.can_manage_plan_poll(plan_id)
    AND closed_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.plan_poll_votes v WHERE v.poll_id = plan_polls.id
    )
  );

CREATE POLICY "Hosts can withdraw an open poll"
  ON public.plan_polls FOR DELETE
  TO authenticated
  USING (public.can_manage_plan_poll(plan_id) AND closed_at IS NULL);

-- Options: host-only writes while the poll is open, and an option freezes on
-- its first vote. "Anora" cannot become "Nosferatu" under three votes.
CREATE POLICY "Hosts can add options to an open poll"
  ON public.plan_poll_options FOR INSERT
  TO authenticated
  WITH CHECK (
    public.can_manage_plan_poll(plan_id)
    AND public.can_vote_plan_poll(poll_id)
  );

CREATE POLICY "Hosts can edit an unvoted option"
  ON public.plan_poll_options FOR UPDATE
  TO authenticated
  USING (
    public.can_manage_plan_poll(plan_id)
    AND public.can_vote_plan_poll(poll_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.plan_poll_votes v
      WHERE v.option_id = plan_poll_options.id
    )
  );

CREATE POLICY "Hosts can remove an unvoted option"
  ON public.plan_poll_options FOR DELETE
  TO authenticated
  USING (
    public.can_manage_plan_poll(plan_id)
    AND public.can_vote_plan_poll(poll_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.plan_poll_votes v
      WHERE v.option_id = plan_poll_options.id
    )
  );

-- Votes: your own row, while the poll is open. Unlike date availability
-- there is no delete-after-close: the tally a poll closed on is the tally it
-- keeps.
CREATE POLICY "Members can cast their own vote"
  ON public.plan_poll_votes FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.can_vote_plan_poll(poll_id));

CREATE POLICY "Members can change their own vote"
  ON public.plan_poll_votes FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() AND public.can_vote_plan_poll(poll_id));

CREATE POLICY "Members can withdraw their own vote"
  ON public.plan_poll_votes FOR DELETE
  TO authenticated
  USING (user_id = auth.uid() AND public.can_vote_plan_poll(poll_id));

-- The close columns are not the client's to write. RLS is row-level; column
-- privileges are what bound which columns a permitted write may touch,
-- exactly as 20260802000005 did for waitlist_seq. A host "closing" a poll by
-- updating closed_at directly would skip the winner arithmetic and the
-- notification fan-out, so the only path to a close is the RPC below.
REVOKE INSERT, UPDATE ON public.plan_polls FROM authenticated, anon;
GRANT INSERT (plan_id, question, suggestions_open),
      UPDATE (question, suggestions_open)
  ON public.plan_polls TO authenticated;

-- --------------------------------------------------------------- the close
--
-- In the shape of lock_plan: authorization raises, outcomes return JSONB.
-- With no argument it closes on the leader; a tie comes back as
-- {closed: false, reason: 'tie'} and the UI asks the host to pick, because
-- auto-resolving by option order is arbitrary in a way people notice. The
-- host's pick must itself be one of the leaders — the poll is the group
-- deciding, and the host tie-breaking is not the host overriding.

CREATE OR REPLACE FUNCTION public.close_plan_poll(
  p_plan_id UUID,
  p_option_id UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_plan public.plans%ROWTYPE;
  v_poll public.plan_polls%ROWTYPE;
  v_authorized BOOLEAN;
  v_max_votes INTEGER;
  v_leaders INTEGER;
  v_winner RECORD;
  v_notified INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Same lock, same order as lock_plan/cancel_plan/enforce_plan_cap, so the
  -- family composes instead of deadlocking. It also serialises against a
  -- concurrent cancel: whoever gets the row second sees the other's verdict.
  SELECT * INTO v_plan FROM public.plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan not found';
  END IF;

  SELECT (v_plan.created_by = v_uid) OR EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = v_plan.group_id AND user_id = v_uid AND role = 'admin'
  ) INTO v_authorized;
  IF NOT v_authorized THEN
    RAISE EXCEPTION 'Only the plan creator or a group admin can close a poll';
  END IF;

  IF v_plan.status = 'cancelled' THEN
    RAISE EXCEPTION 'Plan is cancelled';
  END IF;

  SELECT * INTO v_poll FROM public.plan_polls
  WHERE plan_id = p_plan_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan has no poll';
  END IF;

  IF v_poll.closed_at IS NOT NULL THEN
    RETURN jsonb_build_object('closed', true, 'already_closed', true);
  END IF;

  -- The tally. Zero votes everywhere means there is nothing to close on —
  -- the host who wants the question gone withdraws it instead.
  SELECT MAX(cnt), COUNT(*) FILTER (WHERE cnt = max_cnt)
  INTO v_max_votes, v_leaders
  FROM (
    SELECT COUNT(v.id) AS cnt,
           MAX(COUNT(v.id)) OVER () AS max_cnt
    FROM public.plan_poll_options o
    LEFT JOIN public.plan_poll_votes v ON v.option_id = o.id
    WHERE o.poll_id = v_poll.id
    GROUP BY o.id
  ) tally;

  IF COALESCE(v_max_votes, 0) = 0 THEN
    RETURN jsonb_build_object('closed', false, 'reason', 'no_votes');
  END IF;

  IF p_option_id IS NULL AND v_leaders > 1 THEN
    RETURN jsonb_build_object('closed', false, 'reason', 'tie');
  END IF;

  -- The winner: the named option if it is a leader, else the single leader.
  SELECT o.id, o.label, COUNT(v.id) AS cnt
  INTO v_winner
  FROM public.plan_poll_options o
  LEFT JOIN public.plan_poll_votes v ON v.option_id = o.id
  WHERE o.poll_id = v_poll.id
    AND (p_option_id IS NULL OR o.id = p_option_id)
  GROUP BY o.id, o.label
  HAVING COUNT(v.id) = v_max_votes
  ORDER BY o.position ASC
  LIMIT 1;

  IF NOT FOUND THEN
    -- A named option that is not (or no longer) leading. The client's tally
    -- was stale, or the host tried to override the vote; either way the
    -- refusal reads the same.
    RETURN jsonb_build_object('closed', false, 'reason', 'not_leading');
  END IF;

  UPDATE public.plan_polls
  SET closed_at = NOW(), closed_by = v_uid, winner_option_id = v_winner.id
  WHERE id = v_poll.id;

  -- The answer goes to everyone the plan's own news goes to — the yes-RSVPs
  -- and availability voters cancel_plan notifies — plus anyone who voted in
  -- the poll, minus whoever closed it and minus anyone who blocked them.
  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT DISTINCT u.user_id, 'poll_closed', 'Decided',
         format('%s "%s" it is.', v_poll.question, v_winner.label),
         jsonb_build_object(
           'plan_id', p_plan_id,
           'group_id', v_plan.group_id,
           'poll_id', v_poll.id
         )
  FROM (
    SELECT r.user_id FROM public.rsvps r
    WHERE r.plan_id = p_plan_id AND r.response = 'yes'
    UNION
    SELECT da.user_id FROM public.date_availability da
    WHERE da.plan_id = p_plan_id AND da.available
    UNION
    SELECT pv.user_id FROM public.plan_poll_votes pv
    WHERE pv.poll_id = v_poll.id
  ) u
  WHERE u.user_id <> v_uid
    AND NOT EXISTS (
      SELECT 1 FROM public.blocked_users b
      WHERE b.blocker_id = u.user_id AND b.blocked_id = v_uid
    );
  GET DIAGNOSTICS v_notified = ROW_COUNT;

  RETURN jsonb_build_object(
    'closed', true,
    'winner_option_id', v_winner.id,
    'winner_label', v_winner.label,
    'votes', v_winner.cnt,
    'notified', v_notified
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.close_plan_poll(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_plan_poll(UUID, UUID) TO authenticated;

-- ------------------------------------------------------------ notifications

ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'plan_created', 'plan_locked', 'plan_cancelled', 'plan_reopened',
    'plan_promoted', 'invited_to_group', 'kicked_from_group',
    'poll_opened', 'poll_closed'
  ));

-- A question added to a live plan that nobody hears about gets no votes,
-- which would read as the feature not working. But a poll written in the
-- create sheet arrives seconds after notify_plan_created has already pinged
-- the whole group about this very plan, and two pushes for one post is how
-- people turn pushes off. The plan's age is the only signal that separates
-- the two paths — same INSERT, different moment — so a poll landing inside
-- the plan's first five minutes rides along silently with the plan_created
-- push, and only a question added later announces itself.
CREATE OR REPLACE FUNCTION public.notify_plan_poll_opened()
RETURNS TRIGGER AS $$
DECLARE
  v_plan public.plans%ROWTYPE;
  v_author UUID;
  v_name TEXT;
BEGIN
  SELECT * INTO v_plan FROM public.plans WHERE id = NEW.plan_id;

  IF NOW() - v_plan.created_at < INTERVAL '5 minutes' THEN
    RETURN NEW;
  END IF;

  -- auth.uid() is the person who inserted the poll; a service-role insert
  -- (seeds, tooling) has none, and the host is the honest fallback.
  v_author := COALESCE(auth.uid(), v_plan.created_by);
  SELECT display_name INTO v_name FROM public.profiles WHERE id = v_author;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT gm.user_id, 'poll_opened', 'New question',
         format('%s wants to know: %s', COALESCE(v_name, 'The host'), NEW.question),
         jsonb_build_object(
           'plan_id', NEW.plan_id,
           'group_id', v_plan.group_id,
           'poll_id', NEW.id
         )
  FROM public.group_members gm
  WHERE gm.group_id = v_plan.group_id
    AND gm.user_id <> v_author
    AND gm.notify_new_plans
    AND NOT EXISTS (
      SELECT 1 FROM public.blocked_users b
      WHERE b.blocker_id = gm.user_id AND b.blocked_id = v_author
    );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_notify_plan_poll_opened
  AFTER INSERT ON public.plan_polls
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_plan_poll_opened();

-- ---------------------------------------------------------------- realtime
--
-- Same publication PLA-28 set up in 20260802000004; SUBSCRIBED_TABLES and
-- keysForChange in lib/realtime.ts mirror this. Votes moving under you while
-- you look at the poll is the single most valuable live update this feature
-- has. RLS still decides delivery per subscriber.

ALTER PUBLICATION supabase_realtime ADD TABLE
  public.plan_polls,
  public.plan_poll_options,
  public.plan_poll_votes;
