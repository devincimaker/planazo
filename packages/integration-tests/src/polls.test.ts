// PLA-47: the polls a plan carries. What is under test is the part no mocked
// test reaches: RLS that must allow voting on a *locked* plan (the
// settled-Saturday case is the feature's whole point) while refusing a group
// member who never said they're in, the freeze that stops an option being
// rewritten under its votes, and the schema making a cross-poll vote
// unrepresentable. There is no close: the tally just runs, so what ends a
// poll is its plan, and the only poll-specific act a host holds is
// withdrawal.
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

async function createPlan(
  opts: { status?: 'open' | 'locked' | 'cancelled'; planType?: 'fixed' | 'flexible' } = {},
) {
  const planType = opts.planType ?? 'fixed';
  const planId = ok(
    await host.client
      .from('plans')
      .insert({
        group_id: groupId,
        created_by: host.id,
        title: `poll-${opts.status ?? 'open'}`,
        plan_type: planType,
        event_date: planType === 'fixed' ? daysFromNow(7) : null,
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

/** Puts someone in the plan the way the app does: a yes rsvp. Service role,
 *  because participation here is fixture, not the thing under test. */
async function seatUser(planId: string, user: TestUser) {
  ok(
    await bed.service
      .from('rsvps')
      .upsert(
        { plan_id: planId, user_id: user.id, response: 'yes' },
        { onConflict: 'plan_id,user_id' },
      ),
  );
}

async function createPoll(planId: string, labels = ['Whiplash', 'Perfect Days', 'Aftersun']) {
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

async function votesOf(pollId: string) {
  return ok(
    await bed.service.from('plan_poll_votes').select('option_id, user_id').eq('poll_id', pollId),
  );
}

async function optionsOf(pollId: string) {
  return ok(
    await bed.service
      .from('plan_poll_options')
      .select('id, label')
      .eq('poll_id', pollId)
      .order('position'),
  );
}

describe('reading', () => {
  it('group members see the poll and its attributed votes; an outsider sees nothing', async () => {
    const planId = await createPlan();
    await seatUser(planId, memberA);
    const { pollId, options } = await createPoll(planId);
    ok(await vote(memberA, pollId, planId, options[0].id));

    // memberB never answered the plan: reads everything, votes nothing.
    const seen = ok(
      await memberB.client
        .from('plan_polls')
        .select(
          'question, plan_poll_options!plan_poll_options_poll_id_plan_id_fkey(id), plan_poll_votes(user_id, profile:profiles(display_name))',
        )
        .eq('plan_id', planId),
    );
    expect(seen).toHaveLength(1);
    expect(seen[0].plan_poll_options).toHaveLength(3);
    expect(seen[0].plan_poll_votes).toHaveLength(1);
    // Attributed: the vote carries its name.
    expect((seen[0].plan_poll_votes[0] as any).profile.display_name).toBe('Aina');

    const hidden = ok(await outsider.client.from('plan_polls').select('id').eq('plan_id', planId));
    expect(hidden).toHaveLength(0);
    const hiddenVotes = ok(
      await outsider.client.from('plan_poll_votes').select('id').eq('plan_id', planId),
    );
    expect(hiddenVotes).toHaveLength(0);
  });
});

describe('writing the questions', () => {
  it('only the host writes polls and options', async () => {
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

  it('a plan carries several polls: which film AND who brings what', async () => {
    const planId = await createPlan();
    await createPoll(planId);
    const second = await createPoll(planId, ['Asado', 'Pizza y vino']);
    expect(second.options).toHaveLength(2);

    const polls = ok(
      await host.client.from('plan_polls').select('id').eq('plan_id', planId),
    );
    expect(polls).toHaveLength(2);
  });

  it('an option freezes on its first vote; an unvoted one stays editable', async () => {
    const planId = await createPlan();
    await seatUser(planId, memberA);
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
    expect(after.map((o) => o.label)).toContain('Whiplash');

    // The unvoted one: a typo fix is fine.
    ok(
      await host.client
        .from('plan_poll_options')
        .update({ label: 'Perfect Days (2023)' })
        .eq('id', options[1].id),
    );
    expect((await optionsOf(pollId)).map((o) => o.label)).toContain('Perfect Days (2023)');
  });

  it('the host can withdraw a poll, votes and all; a member cannot', async () => {
    const planId = await createPlan();
    await seatUser(planId, memberA);
    const { pollId, options } = await createPoll(planId);
    ok(await vote(memberA, pollId, planId, options[0].id));

    ok(await memberA.client.from('plan_polls').delete().eq('id', pollId));
    expect(
      ok(await bed.service.from('plan_polls').select('id').eq('id', pollId)),
    ).toHaveLength(1);

    ok(await host.client.from('plan_polls').delete().eq('id', pollId));
    expect(ok(await bed.service.from('plan_polls').select('id').eq('id', pollId))).toHaveLength(0);
    // The cascade took the votes with it.
    expect(await votesOf(pollId)).toHaveLength(0);
  });
});

describe('who gets a pick', () => {
  it('a member who never said they are in reads the tally but holds no vote', async () => {
    const planId = await createPlan();
    const { pollId, options } = await createPoll(planId);

    const refused = await vote(memberA, pollId, planId, options[0].id);
    expect(refused.error).toBeTruthy();

    // Saying yes is what buys the pick.
    await seatUser(planId, memberA);
    ok(await vote(memberA, pollId, planId, options[0].id));
    expect(await votesOf(pollId)).toHaveLength(1);
  });

  it('the host holds a pick without an rsvp row', async () => {
    const planId = await createPlan();
    const { pollId, options } = await createPoll(planId);
    ok(await vote(host, pollId, planId, options[0].id));
    expect(await votesOf(pollId)).toHaveLength(1);
  });

  it('an availability voter on an open date vote is in', async () => {
    const planId = await createPlan({ planType: 'flexible' });
    const optionId = ok(
      await host.client
        .from('plan_date_options')
        .insert({ plan_id: planId, date: daysFromNow(7) })
        .select('id')
        .single(),
    ).id;
    ok(
      await memberA.client.from('date_availability').insert({
        plan_id: planId,
        user_id: memberA.id,
        date_option_id: optionId,
        available: true,
      }),
    );

    const { pollId, options } = await createPoll(planId);
    ok(await vote(memberA, pollId, planId, options[0].id));
    expect(await votesOf(pollId)).toHaveLength(1);
  });

  it('voting works on a locked plan: a settled date is where a live poll lives', async () => {
    const planId = await createPlan();
    await seatUser(planId, memberA);
    ok(await bed.service.from('plans').update({ status: 'locked' }).eq('id', planId));

    const { pollId, options } = await createPoll(planId);
    ok(await vote(memberA, pollId, planId, options[0].id));
    expect(await votesOf(pollId)).toHaveLength(1);
  });
});

describe('the vote itself', () => {
  it('is single choice: a second tap moves it, a delete withdraws it', async () => {
    const planId = await createPlan();
    await seatUser(planId, memberA);
    const { pollId, options } = await createPoll(planId);

    ok(await vote(memberA, pollId, planId, options[0].id));
    ok(await vote(memberA, pollId, planId, options[2].id));

    let votes = await votesOf(pollId);
    expect(votes).toHaveLength(1);
    expect(votes[0].option_id).toBe(options[2].id);

    ok(
      await memberA.client
        .from('plan_poll_votes')
        .delete()
        .eq('poll_id', pollId)
        .eq('user_id', memberA.id),
    );
    votes = await votesOf(pollId);
    expect(votes).toHaveLength(0);
  });

  it('refuses on a cancelled plan, and refuses another poll’s option outright', async () => {
    // The poll has to exist before the cancel: its own INSERT policy already
    // refuses a dead plan.
    const planId = await createPlan();
    await seatUser(planId, memberA);
    const { pollId, options } = await createPoll(planId);
    ok(await bed.service.from('plans').update({ status: 'cancelled' }).eq('id', planId));
    const res = await vote(memberA, pollId, planId, options[0].id);
    expect(res.error).toBeTruthy();

    // Cross-poll voting is a schema impossibility, not a policy nicety.
    const otherPlan = await createPlan();
    await seatUser(otherPlan, memberA);
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

describe('the opening ping', () => {
  it('a poll added to a live plan announces itself; one born with its plan stays quiet', async () => {
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
