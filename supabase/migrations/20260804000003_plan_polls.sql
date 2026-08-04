-- PLA-47: a plan can carry polls the people in it vote on.
--
-- Planazo can decide when; this is the first step toward deciding what. The
-- host writes a question and its options, everyone who is in gets one vote,
-- and the tally just runs. Nothing closes it: the poll stays open as long as
-- the plan does, and the group decides when it is decided. That keeps the
-- surface to one idiom — answering — with no second host ceremony to learn,
-- and no way to mislock a plan by pressing the wrong "close".
--
-- Deliberately NOT a third plan type. plan_date_options already does voting,
-- but generalising it would leave a plan with exactly one undecided thing,
-- and the motivating case has two: Saturday settled, film TBD. So polls are
-- separate objects hanging off the plan, several of them if the host wants
-- ("Which film" and "Who brings what" on the same weekend), and they must
-- coexist with a locked date. Two consequences fall out of that split and
-- everything below serves them:
--
--   1. **Voting works on a locked plan.** The date-availability policies
--      require plans.status = 'open', and mirroring them literally would kill
--      voting on exactly the plan this feature exists for (the settled
--      Saturday is a *locked* plan). So every predicate here asks
--      "not cancelled", never "open".
--
--   2. **Polls do not gate confirmation.** A date option winning is the
--      plan; a film winning is a detail of a plan already happening.
--      isPlanConfirmed() in plan-logic.ts knows nothing about polls, and a
--      test there pins it.
--
-- Who votes: **the people who are in**, not the whole group. A poll is a
-- detail of attendance ("which film are WE seeing"), so a bystander who
-- never answered the plan reads the tally but holds no pick, and "say you're
-- in and you get a pick" becomes one more reason to answer. Votes are stored
-- attributed and rendered attributed: names show against every option.
--
-- Single choice, one row per person per poll under UNIQUE (poll_id, user_id).
-- Changing your mind is an upsert; tapping your own pick withdraws it. If
-- PLA-48's open option list ever fragments the tally, approval voting is one
-- dropped constraint away, while the reverse would mean deleting votes.
--
-- Cancel and reopen need no poll-specific handling, by construction: a
-- cancelled plan fails every write predicate here, restore_plan makes them
-- pass again, and reopen_plan (the date vote) never touches poll state.

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
  plan_id UUID NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  -- Unused until PLA-48 lets members add options. The column is free now and
  -- a migration later.
  suggestions_open BOOLEAN NOT NULL DEFAULT false,
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

-- The detail screen and the feed card both fetch by plan.
CREATE INDEX idx_plan_polls_plan ON public.plan_polls(plan_id, created_at);
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

-- Who may write questions and options: is_plan_host, the single host-or-admin
-- predicate PLA-42 created after four RPCs drifted — writing the pair out
-- again by hand is how the fifth drift starts (an early draft here did, and
-- lost PLA-42's membership requirement on the creator branch). The cancelled
-- check lives here because every management action dies with the plan.
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
      AND public.is_plan_host(p.group_id, p.created_by)
  );
$$;

-- Who may vote: someone who is IN the plan, while it is not cancelled. In
-- means a yes (fixed or locked plans) or availability on the running date
-- vote (open flexible plans) — the same two populations the app calls
-- isUserParticipating. The host counts regardless: they own the plan even if
-- a seed or an edge path never wrote their rsvp row. Note what is absent:
-- plans.status = 'open'. A locked plan with a settled date is the primary
-- home of a live poll, not an edge case.
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
      AND p.status <> 'cancelled'
      AND public.is_group_member(p.group_id)
      AND (
        p.created_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.rsvps r
          WHERE r.plan_id = p.id
            AND r.user_id = auth.uid()
            AND r.response = 'yes'
        )
        OR EXISTS (
          SELECT 1 FROM public.date_availability da
          WHERE da.plan_id = p.id
            AND da.user_id = auth.uid()
            AND da.available
        )
      )
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

-- Reading: the whole group. A bystander sees the tally (that is half the
-- pitch for saying you're in); only voting is participation-gated. Votes are
-- attributed rows rendered attributed.
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

-- The poll itself: host writes it, host may fix the question while nobody
-- has voted, host may withdraw it whenever. The no-votes freeze on UPDATE is
-- the typo rule: fixing "Wich film?" is fine until the first vote lands,
-- after which swapping the question under people's votes is the same UPDATE
-- and the answer to both is no. Withdrawal stays possible with votes on the
-- board — with no close, removal is the only way a poll ever ends early, and
-- removal is honest where alteration is not.
CREATE POLICY "Hosts can add a poll"
  ON public.plan_polls FOR INSERT
  TO authenticated
  WITH CHECK (public.can_manage_plan_poll(plan_id));

CREATE POLICY "Hosts can edit an unvoted poll"
  ON public.plan_polls FOR UPDATE
  TO authenticated
  USING (
    public.can_manage_plan_poll(plan_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.plan_poll_votes v WHERE v.poll_id = plan_polls.id
    )
  );

CREATE POLICY "Hosts can withdraw a poll"
  ON public.plan_polls FOR DELETE
  TO authenticated
  USING (public.can_manage_plan_poll(plan_id));

-- Options: host-only writes, and an option freezes on its first vote.
-- "Anora" cannot become "Nosferatu" under three votes.
CREATE POLICY "Hosts can add options"
  ON public.plan_poll_options FOR INSERT
  TO authenticated
  WITH CHECK (public.can_manage_plan_poll(plan_id));

CREATE POLICY "Hosts can edit an unvoted option"
  ON public.plan_poll_options FOR UPDATE
  TO authenticated
  USING (
    public.can_manage_plan_poll(plan_id)
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
    AND NOT EXISTS (
      SELECT 1 FROM public.plan_poll_votes v
      WHERE v.option_id = plan_poll_options.id
    )
  );

-- Votes: your own row, while you are in and the plan lives. Delete is how
-- tapping your own pick withdraws it.
CREATE POLICY "Participants can cast their own vote"
  ON public.plan_poll_votes FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.can_vote_plan_poll(poll_id));

CREATE POLICY "Participants can change their own vote"
  ON public.plan_poll_votes FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() AND public.can_vote_plan_poll(poll_id));

CREATE POLICY "Participants can withdraw their own vote"
  ON public.plan_poll_votes FOR DELETE
  TO authenticated
  USING (user_id = auth.uid() AND public.can_vote_plan_poll(poll_id));

-- ------------------------------------------------------------ notifications

ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'plan_created', 'plan_locked', 'plan_cancelled', 'plan_reopened',
    'plan_promoted', 'invited_to_group', 'kicked_from_group',
    'poll_opened'
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
-- you look at the tally is the single most valuable live update this feature
-- has. RLS still decides delivery per subscriber.

ALTER PUBLICATION supabase_realtime ADD TABLE
  public.plan_polls,
  public.plan_poll_options,
  public.plan_poll_votes;
