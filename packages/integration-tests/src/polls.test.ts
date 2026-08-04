// PLA-47: the one open question a plan can carry. What is under test is the
// part no mocked test reaches: RLS that must allow voting on a *locked* plan
// (the settled-Saturday case is the feature's whole point), the freeze that
// stops an option being rewritten under its votes, the close RPC's tie
// arithmetic, and the column grants that make closing unreachable except
// through it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestBed, TestUser, ok, daysFromNow } from './testbed';

const bed = new TestBed();
let host: TestUser;
let memberA: TestUser;
let memberB: TestUser;
let outsider: TestUser;
let groupId: string;

beforeAll(async () => {
  host = await bed.createUser('Marta');
  memberA = await bed.createUser('Aina');
  memberB = await bed.createUser('Jordi');
  outsider = await bed.createUser('Nadie');
  const group = await bed.createGroup(host);
  groupId = group.id;
  await bed.join(groupId, memberA);
  await bed.join(groupId, memberB);
}, 60_000);

afterAll(() => bed.dispose());

async function createPlan(opts: { status?: 'open' | 'locked' | 'cancelled' } = {}) {
  const planId = ok(
    await host.client
      .from('plans')
      .insert({
        group_id: groupId,
        created_by: host.id,
        title: `poll-${opts.status ?? 'open'}`,
        plan_type: 'fixed',
        event_date: daysFromNow(7),
        min_people: 2,
      })
      .select('id')
      .single(),
  ).id;
  if (opts.status && opts.status !== 'open') {
    // Straight to the target state; the lock/cancel paths have their own suite.
    ok(await bed.service.from('plans').update({ status: opts.status }).eq('id', planId));
  }
  return planId;
}

async function createPoll(planId: string, labels = ['Dune Part Two', 'The Substance', 'Anora']) {
  const pollId = ok(
    await host.client
      .from('plan_polls')
      .insert({ plan_id: planId, question: 'Which film?' })
      .select('id')
      .single(),
  ).id;
  ok(
    await host.client
      .from('plan_poll_options')
      .insert(labels.map((label, i) => ({ poll_id: pollId, plan_id: planId, label, position: i }))),
  );
  const options = ok(
    await host.client
      .from('plan_poll_options')
      .select('id, label')
      .eq('poll_id', pollId)
      .order('position'),
  );
  return { pollId, options };
}

const vote = (user: TestUser, pollId: string, planId: string, optionId: string) =>
  user.client
    .from('plan_poll_votes')
    .upsert(
      { poll_id: pollId, plan_id: planId, user_id: user.id, option_id: optionId },
      { onConflict: 'poll_id,user_id' },
    );

describe('reading', () => {
  it('group members see the poll; an outsider sees nothing at all', async () => {
    const planId = await createPlan();
    const { pollId } = await createPoll(planId);
    ok(await vote(memberA, pollId, planId, (await optionsOf(pollId))[0].id));

    const seen = ok(
      await memberB.client
        .from('plan_polls')
        // The FK hint mirrors the app's queries: winner_option_id makes a
        // second relationship between these tables, so the embed must name
        // which one it means.
        .select(
          'question, plan_poll_options!plan_poll_options_poll_id_plan_id_fkey(id), plan_poll_votes(user_id)',
        )
        .eq('plan_id', planId),
    );
    expect(seen).toHaveLength(1);
    expect(seen[0].plan_poll_options).toHaveLength(3);
    expect(seen[0].plan_poll_votes).toHaveLength(1);

    const hidden = ok(
      await outsider.client.from('plan_polls').select('id').eq('plan_id', planId),
    );
    expect(hidden).toHaveLength(0);
    const hiddenVotes = ok(
      await outsider.client.from('plan_poll_votes').select('id').eq('plan_id', planId),
    );
    expect(hiddenVotes).toHaveLength(0);
  });
});

async function optionsOf(pollId: string) {
  return ok(
    await bed.service
      .from('plan_poll_options')
      .select('id, label')
      .eq('poll_id', pollId)
      .order('position'),
  );
}

describe('writing the question', () => {
  it('only the host writes the poll and its options', async () => {
    const planId = await createPlan();

    const memberPoll = await memberA.client
      .from('plan_polls')
      .insert({ plan_id: planId, question: 'Can I?' })
      .select('id')
      .single();
    expect(memberPoll.error).toBeTruthy();

    const { pollId } = await createPoll(planId);
    const memberOption = await memberA.client
      .from('plan_poll_options')
      .insert({ poll_id: pollId, plan_id: planId, label: 'Sneaky', position: 9 });
    expect(memberOption.error).toBeTruthy();
  });

  it('one question per plan', async () => {
    const planId = await createPlan();
    await createPoll(planId);
    const second = await host.client
      .from('plan_polls')
      .insert({ plan_id: planId, question: 'And also?' })
      .select('id')
      .single();
    expect(second.error?.message).toMatch(/duplicate|unique/i);
  });

  it('an option freezes on its first vote; an unvoted one stays editable', async () => {
    const planId = await createPlan();
    const { pollId, options } = await createPoll(planId);
    ok(await vote(memberA, pollId, planId, options[0].id));

    // The voted option: neither label swap nor delete goes through.
    ok(
      await host.client
        .from('plan_poll_options')
        .update({ label: 'Nosferatu' })
        .eq('id', options[0].id),
    );
    ok(await host.client.from('plan_poll_options').delete().eq('id', options[0].id));
    const after = await optionsOf(pollId);
    expect(after.map((o) => o.label)).toContain('Dune Part Two');

    // The unvoted one: a typo fix is fine.
    ok(
      await host.client
        .from('plan_poll_options')
        .update({ label: 'The Substance (2024)' })
        .eq('id', options[1].id),
    );
    expect((await optionsOf(pollId)).map((o) => o.label)).toContain('The Substance (2024)');
  });

  it('the client cannot close a poll by writing the close columns', async () => {
    const planId = await createPlan();
    const { pollId } = await createPoll(planId);
    const res = await host.client
      .from('plan_polls')
      .update({ closed_at: new Date().toISOString(), closed_by: host.id } as never)
      .eq('id', pollId);
    expect(res.error).toBeTruthy();
    const poll = ok(
      await bed.service.from('plan_polls').select('closed_at').eq('id', pollId).single(),
    );
    expect(poll.closed_at).toBeNull();
  });
});

describe('voting', () => {
  it('is single choice: a second tap moves the vote, it never adds one', async () => {
    const planId = await createPlan();
    const { pollId, options } = await createPoll(planId);

    ok(await vote(memberA, pollId, planId, options[0].id));
    ok(await vote(memberA, pollId, planId, options[2].id));

    const votes = ok(
      await bed.service.from('plan_poll_votes').select('option_id').eq('poll_id', pollId),
    );
    expect(votes).toHaveLength(1);
    expect(votes[0].option_id).toBe(options[2].id);
  });

  it('works on a locked plan: a settled date is where a live question lives', async () => {
    const planId = await createPlan({ status: 'locked' });
    const { pollId, options } = await createPoll(planId);
    ok(await vote(memberA, pollId, planId, options[0].id));
    const votes = ok(
      await bed.service.from('plan_poll_votes').select('id').eq('poll_id', pollId),
    );
    expect(votes).toHaveLength(1);
  });

  it('refuses on a cancelled plan, and refuses another poll’s option outright', async () => {
    // The poll has to exist before the cancel: its own INSERT policy already
    // refuses a dead plan.
    const planId = await createPlan();
    const { pollId, options } = await createPoll(planId);
    ok(await bed.service.from('plans').update({ status: 'cancelled' }).eq('id', planId));
    const res = await vote(memberA, pollId, planId, options[0].id);
    expect(res.error).toBeTruthy();

    // Cross-poll voting is a schema impossibility, not a policy nicety.
    const otherPlan = await createPlan();
    const other = await createPoll(otherPlan);
    const cross = await memberA.client.from('plan_poll_votes').insert({
      poll_id: other.pollId,
      plan_id: otherPlan,
      user_id: memberA.id,
      option_id: options[0].id,
    });
    expect(cross.error?.message).toMatch(/foreign key|violates/i);
  });
});

describe('closing', () => {
  it('records the leader, stamps who closed it, and tells the room', async () => {
    const planId = await createPlan();
    const { pollId, options } = await createPoll(planId);
    ok(await vote(memberA, pollId, planId, options[0].id));
    ok(await vote(memberB, pollId, planId, options[0].id));

    // A guest cannot close it.
    const guest = await memberA.client.rpc('close_plan_poll', { p_plan_id: planId });
    expect(guest.error?.message).toMatch(/creator|admin/i);

    const res = ok(await host.client.rpc('close_plan_poll', { p_plan_id: planId })) as any;
    expect(res.closed).toBe(true);
    expect(res.winner_label).toBe('Dune Part Two');
    expect(res.votes).toBe(2);

    const poll = ok(
      await bed.service
        .from('plan_polls')
        .select('closed_at, closed_by, winner_option_id')
        .eq('id', pollId)
        .single(),
    );
    expect(poll.closed_at).not.toBeNull();
    expect(poll.closed_by).toBe(host.id);
    expect(poll.winner_option_id).toBe(options[0].id);

    // Voters heard, minus the closer.
    const notes = ok(
      await bed.service
        .from('notifications')
        .select('user_id, body')
        .eq('type', 'poll_closed')
        .contains('data', { plan_id: planId }),
    );
    expect(notes.map((n) => n.user_id).sort()).toEqual([memberA.id, memberB.id].sort());
    expect(notes[0].body).toContain('Dune Part Two');

    // Closing twice is a no-op, not an error.
    const again = ok(await host.client.rpc('close_plan_poll', { p_plan_id: planId })) as any;
    expect(again.already_closed).toBe(true);

    // And the closed poll takes no more votes.
    const late = await vote(memberA, pollId, planId, options[1].id);
    expect(late.error).toBeTruthy();
  });

  it('a tie comes back as a refusal, and the host may only pick a leader', async () => {
    const planId = await createPlan();
    const { pollId, options } = await createPoll(planId);
    ok(await vote(memberA, pollId, planId, options[0].id));
    ok(await vote(memberB, pollId, planId, options[1].id));

    const tie = ok(await host.client.rpc('close_plan_poll', { p_plan_id: planId })) as any;
    expect(tie).toEqual({ closed: false, reason: 'tie' });

    // Not a leader: refused, not honoured.
    const overridden = ok(
      await host.client.rpc('close_plan_poll', { p_plan_id: planId, p_option_id: options[2].id }),
    ) as any;
    expect(overridden).toEqual({ closed: false, reason: 'not_leading' });

    // A leader: the host's tie-break stands.
    const broken = ok(
      await host.client.rpc('close_plan_poll', { p_plan_id: planId, p_option_id: options[1].id }),
    ) as any;
    expect(broken.closed).toBe(true);
    expect(broken.winner_label).toBe('The Substance');
  });

  it('refuses an empty poll and a cancelled plan', async () => {
    const planId = await createPlan();
    await createPoll(planId);
    const empty = ok(await host.client.rpc('close_plan_poll', { p_plan_id: planId })) as any;
    expect(empty).toEqual({ closed: false, reason: 'no_votes' });

    ok(await bed.service.from('plans').update({ status: 'cancelled' }).eq('id', planId));
    const cancelled = await host.client.rpc('close_plan_poll', { p_plan_id: planId });
    expect(cancelled.error?.message).toMatch(/cancelled/i);
  });
});

describe('the opening ping', () => {
  it('a question added to a live plan announces itself; one born with its plan stays quiet', async () => {
    // Born with the plan: created seconds after, inside the quiet window.
    const freshPlan = await createPlan();
    await createPoll(freshPlan);
    const quiet = ok(
      await bed.service
        .from('notifications')
        .select('id')
        .eq('type', 'poll_opened')
        .contains('data', { plan_id: freshPlan }),
    );
    expect(quiet).toHaveLength(0);

    // Added later: backdate the plan past the window, then ask.
    const oldPlan = await createPlan();
    ok(
      await bed.service
        .from('plans')
        .update({ created_at: daysFromNow(-1) })
        .eq('id', oldPlan),
    );
    await createPoll(oldPlan);
    const heard = ok(
      await bed.service
        .from('notifications')
        .select('user_id, body')
        .eq('type', 'poll_opened')
        .contains('data', { plan_id: oldPlan }),
    );
    // Every member except the asker.
    expect(heard.map((n) => n.user_id).sort()).toEqual([memberA.id, memberB.id].sort());
    expect(heard[0].body).toContain('Which film?');
  });
});
