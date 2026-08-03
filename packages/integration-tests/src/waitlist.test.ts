// PLA-37: the waiting list. PLA-20 made the cap real but left the refusal with
// no recourse — whoever lock_plan could not seat got no row at all, and a place
// freed by a withdrawal went to whoever refreshed first.
//
// What is under test here is almost entirely invisible from the client: two
// triggers, an ordering column nobody may write, and the promotion that has to
// happen exactly once no matter which of five paths freed the seat. Mocked
// tests reach none of it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestBed, TestUser, ok, daysFromNow } from './testbed';

const bed = new TestBed();
let host: TestUser;
let memberA: TestUser;
let memberB: TestUser;
let memberC: TestUser;
let groupId: string;

async function createPlan(opts: {
  planType: 'fixed' | 'flexible';
  maxPeople: number | null;
  minPeople?: number;
  eventDate?: string;
}) {
  return ok(
    await host.client
      .from('plans')
      .insert({
        group_id: groupId,
        created_by: host.id,
        title: `wait-${opts.planType}-${opts.maxPeople ?? 'none'}`,
        plan_type: opts.planType,
        event_date:
          opts.planType === 'fixed' ? (opts.eventDate ?? daysFromNow(7)) : null,
        min_people: opts.minPeople ?? 2,
        max_people: opts.maxPeople,
      })
      .select('id')
      .single(),
  ).id;
}

const say = (user: TestUser, planId: string, response: 'yes' | 'no' | 'pending') =>
  user.client
    .from('rsvps')
    .upsert({ plan_id: planId, user_id: user.id, response }, { onConflict: 'plan_id,user_id' });

const withdraw = (user: TestUser, planId: string) =>
  user.client.from('rsvps').delete().eq('plan_id', planId).eq('user_id', user.id);

/** Every row on the plan, service-role so RLS cannot hide the queue. */
async function rows(planId: string) {
  return ok(
    await bed.service
      .from('rsvps')
      .select('user_id, response, waitlist_seq')
      .eq('plan_id', planId),
  );
}

/** User ids with a seat. */
async function seated(planId: string): Promise<string[]> {
  return (await rows(planId)).filter((r) => r.response === 'yes').map((r) => r.user_id);
}

/** User ids waiting, in queue order. */
async function queue(planId: string): Promise<string[]> {
  return (await rows(planId))
    .filter((r) => r.response === 'pending')
    .sort((a, b) => a.waitlist_seq! - b.waitlist_seq!)
    .map((r) => r.user_id);
}

async function promotions(planId: string): Promise<string[]> {
  return ok(
    await bed.service
      .from('notifications')
      .select('user_id')
      .eq('type', 'plan_promoted')
      .filter('data->>plan_id', 'eq', planId),
  ).map((n) => n.user_id);
}

/** A full fixed plan: host and memberA hold both places. */
async function fullPlan(maxPeople = 2) {
  const planId = await createPlan({ planType: 'fixed', maxPeople });
  ok(await say(host, planId, 'yes'));
  ok(await say(memberA, planId, 'yes'));
  return planId;
}

beforeAll(async () => {
  [host, memberA, memberB, memberC] = await Promise.all([
    bed.createUser('Wait Host'),
    bed.createUser('Wait MemberA'),
    bed.createUser('Wait MemberB'),
    bed.createUser('Wait MemberC'),
  ]);
  const group = await bed.createGroup(host);
  groupId = group.id;
  await bed.join(groupId, memberA);
  await bed.join(groupId, memberB);
  await bed.join(groupId, memberC);
});

afterAll(() => bed.dispose());

describe('joining the list', () => {
  it('takes a place, in the order people asked for one', async () => {
    const planId = await fullPlan();

    ok(await say(memberB, planId, 'pending'));
    ok(await say(memberC, planId, 'pending'));

    expect(await queue(planId)).toEqual([memberB.id, memberC.id]);
    // A place in the queue is not a seat.
    expect(await seated(planId)).toHaveLength(2);
  });

  it('re-tapping keeps the place rather than taking a new one', async () => {
    const planId = await fullPlan();
    ok(await say(memberB, planId, 'pending'));
    ok(await say(memberC, planId, 'pending'));

    const before = (await rows(planId)).find((r) => r.user_id === memberB.id)!.waitlist_seq;
    ok(await say(memberB, planId, 'pending'));
    const after = (await rows(planId)).find((r) => r.user_id === memberB.id)!.waitlist_seq;

    expect(after).toBe(before);
    expect(await queue(planId)).toEqual([memberB.id, memberC.id]);
  });

  it('leaving the list gives up the place and promotes nobody', async () => {
    const planId = await fullPlan();
    ok(await say(memberB, planId, 'pending'));
    ok(await say(memberC, planId, 'pending'));

    ok(await withdraw(memberB, planId));

    expect(await queue(planId)).toEqual([memberC.id]);
    expect(await seated(planId)).toHaveLength(2);
    expect(await promotions(planId)).toEqual([]);
  });

  it('clears the place when a waiter declines instead', async () => {
    const planId = await fullPlan();
    ok(await say(memberB, planId, 'pending'));

    ok(await say(memberB, planId, 'no'));

    const row = (await rows(planId)).find((r) => r.user_id === memberB.id)!;
    expect(row.response).toBe('no');
    // A number outliving the pending state would leave a ghost in the queue.
    expect(row.waitlist_seq).toBeNull();
  });

  it('refuses a client that tries to pick its own place', async () => {
    const planId = await fullPlan();
    ok(await say(memberB, planId, 'pending'));

    // RLS is row-level: without the column grant from this migration, the
    // "own row on a live plan" policy would happily allow this and memberC
    // would jump memberB by writing a smaller number.
    const { error } = await memberC.client
      .from('rsvps')
      .insert({ plan_id: planId, user_id: memberC.id, response: 'pending', waitlist_seq: 0 });

    expect(error).not.toBeNull();
    expect(await queue(planId)).toEqual([memberB.id]);
  });

  it('refuses a client that tries to renumber a place it already holds', async () => {
    const planId = await fullPlan();
    ok(await say(memberB, planId, 'pending'));
    ok(await say(memberC, planId, 'pending'));

    const { error } = await memberC.client
      .from('rsvps')
      .update({ waitlist_seq: -1 })
      .eq('plan_id', planId)
      .eq('user_id', memberC.id);

    expect(error).not.toBeNull();
    expect(await queue(planId)).toEqual([memberB.id, memberC.id]);
  });
});

describe('promotion', () => {
  it('gives a freed place to the person who has waited longest', async () => {
    const planId = await fullPlan();
    ok(await say(memberB, planId, 'pending'));
    ok(await say(memberC, planId, 'pending'));

    ok(await withdraw(memberA, planId));

    expect((await seated(planId)).sort()).toEqual([host.id, memberB.id].sort());
    expect(await queue(planId)).toEqual([memberC.id]);
    expect(await promotions(planId)).toEqual([memberB.id]);
  });

  it('promotes exactly one person per place, not the whole queue', async () => {
    const planId = await fullPlan();
    ok(await say(memberB, planId, 'pending'));
    ok(await say(memberC, planId, 'pending'));

    ok(await withdraw(memberA, planId));

    expect(await seated(planId)).toHaveLength(2);
    expect(await queue(planId)).toHaveLength(1);
  });

  it('clears the promoted row\'s number', async () => {
    const planId = await fullPlan();
    ok(await say(memberB, planId, 'pending'));

    ok(await withdraw(memberA, planId));

    const row = (await rows(planId)).find((r) => r.user_id === memberB.id)!;
    expect(row.response).toBe('yes');
    expect(row.waitlist_seq).toBeNull();
  });

  it('fires when an attendee declines rather than withdrawing', async () => {
    const planId = await fullPlan();
    ok(await say(memberB, planId, 'pending'));

    ok(await say(memberA, planId, 'no'));

    expect((await seated(planId)).sort()).toEqual([host.id, memberB.id].sort());
  });

  it('fires when the seat is freed by someone leaving the group', async () => {
    // cleanup_on_leave_group deletes RSVPs in bulk across every plan in the
    // group. An RPC-based promotion would never have run here; the trigger
    // cannot be routed around.
    const leaver = await bed.createUser('Wait Leaver');
    await bed.join(groupId, leaver);

    const planId = await createPlan({ planType: 'fixed', maxPeople: 2 });
    ok(await say(host, planId, 'yes'));
    ok(await say(leaver, planId, 'yes'));
    ok(await say(memberB, planId, 'pending'));

    ok(await leaver.client.from('group_members').delete().eq('group_id', groupId).eq('user_id', leaver.id));

    expect((await seated(planId)).sort()).toEqual([host.id, memberB.id].sort());
    expect(await queue(planId)).toEqual([]);
  });

  it('takes two withdrawals as two places', async () => {
    const planId = await createPlan({ planType: 'fixed', maxPeople: 3 });
    for (const u of [host, memberA, memberB]) ok(await say(u, planId, 'yes'));
    ok(await say(memberC, planId, 'pending'));

    ok(await withdraw(memberA, planId));
    ok(await withdraw(memberB, planId));

    // Only one person was waiting, so only one place could be filled.
    expect((await seated(planId)).sort()).toEqual([host.id, memberC.id].sort());
    expect(await queue(planId)).toEqual([]);
    expect(await promotions(planId)).toEqual([memberC.id]);
  });

  it('promotes nobody on an uncapped plan', async () => {
    const planId = await createPlan({ planType: 'fixed', maxPeople: null });
    ok(await say(host, planId, 'yes'));
    ok(await say(memberA, planId, 'yes'));
    // Nothing in the app can produce this on an uncapped plan; written
    // service-side to prove the trigger refuses rather than trusting the UI.
    ok(
      await bed.service
        .from('rsvps')
        .insert({ plan_id: planId, user_id: memberB.id, response: 'pending' }),
    );

    ok(await withdraw(memberA, planId));

    expect(await queue(planId)).toEqual([memberB.id]);
    expect(await promotions(planId)).toEqual([]);
  });

  it('promotes nobody once the date has gone', async () => {
    const planId = await createPlan({
      planType: 'fixed',
      maxPeople: 2,
      eventDate: daysFromNow(-3),
    });
    ok(await say(host, planId, 'yes'));
    ok(await say(memberA, planId, 'yes'));
    ok(await say(memberB, planId, 'pending'));

    ok(await withdraw(memberA, planId));

    expect(await seated(planId)).toEqual([host.id]);
    expect(await queue(planId)).toEqual([memberB.id]);
    expect(await promotions(planId)).toEqual([]);
  });

  it('promotes nobody on a cancelled plan', async () => {
    const planId = await fullPlan();
    ok(await say(memberB, planId, 'pending'));
    ok(await host.client.rpc('cancel_plan', { p_plan_id: planId }));

    // The seat is freed service-side: RLS freezes RSVPs on a cancelled plan,
    // so the client cannot reach this state. The trigger still must not fire.
    ok(await bed.service.from('rsvps').delete().eq('plan_id', planId).eq('user_id', memberA.id));

    expect(await queue(planId)).toEqual([memberB.id]);
    expect(await promotions(planId)).toEqual([]);
  });
});

describe('lock_plan overflow', () => {
  async function flexiblePlanEveryoneFree(maxPeople: number | null) {
    const planId = await createPlan({ planType: 'flexible', maxPeople, minPeople: 2 });
    const optionId = ok(
      await host.client
        .from('plan_date_options')
        .insert({ plan_id: planId, date: daysFromNow(7).slice(0, 10) })
        .select('id')
        .single(),
    ).id;

    // Sequential: the queue is the continuation of first-come-first-served on
    // date_availability.created_at, so the write order is the thing under test.
    for (const user of [host, memberA, memberB, memberC]) {
      ok(
        await user.client.from('date_availability').insert({
          plan_id: planId,
          user_id: user.id,
          date_option_id: optionId,
          available: true,
        }),
      );
    }
    return planId;
  }

  it('puts whoever it could not seat on the list, in availability order', async () => {
    const planId = await flexiblePlanEveryoneFree(2);

    ok(await host.client.rpc('lock_plan', { p_plan_id: planId }));

    expect((await seated(planId)).sort()).toEqual([host.id, memberA.id].sort());
    expect(await queue(planId)).toEqual([memberB.id, memberC.id]);
  });

  it('does not tell the overflow the plan is happening', async () => {
    const planId = await flexiblePlanEveryoneFree(2);
    ok(await host.client.rpc('lock_plan', { p_plan_id: planId }));

    const told = ok(
      await bed.service
        .from('notifications')
        .select('user_id')
        .eq('type', 'plan_locked')
        .filter('data->>plan_id', 'eq', planId),
    ).map((n) => n.user_id);

    expect(told.sort()).toEqual([host.id, memberA.id].sort());
  });

  it('hands a place from the locked plan to the head of its queue', async () => {
    const planId = await flexiblePlanEveryoneFree(2);
    ok(await host.client.rpc('lock_plan', { p_plan_id: planId }));

    // PLA-16: withdrawal from a locked plan is exactly when a place opens up.
    ok(await withdraw(memberA, planId));

    expect((await seated(planId)).sort()).toEqual([host.id, memberB.id].sort());
    expect(await queue(planId)).toEqual([memberC.id]);
    expect(await promotions(planId)).toEqual([memberB.id]);
  });

  it('queues nobody when the plan is uncapped', async () => {
    const planId = await flexiblePlanEveryoneFree(null);
    ok(await host.client.rpc('lock_plan', { p_plan_id: planId }));

    expect(await seated(planId)).toHaveLength(4);
    expect(await queue(planId)).toEqual([]);
  });

  it('keeps the place of someone already waiting when the plan is re-locked', async () => {
    const planId = await createPlan({ planType: 'flexible', maxPeople: 2, minPeople: 2 });
    const [early, late] = await Promise.all([
      host.client
        .from('plan_date_options')
        .insert({ plan_id: planId, date: daysFromNow(7).slice(0, 10) })
        .select('id')
        .single(),
      host.client
        .from('plan_date_options')
        .insert({ plan_id: planId, date: daysFromNow(14).slice(0, 10) })
        .select('id')
        .single(),
    ]);
    const d1 = ok(early).id;
    const d2 = ok(late).id;

    const free = async (user: TestUser, optionId: string) =>
      ok(
        await user.client.from('date_availability').insert({
          plan_id: planId,
          user_id: user.id,
          date_option_id: optionId,
          available: true,
        }),
      );

    // D1 seats host and memberA; memberC waits. D2 adds memberB behind them.
    await free(host, d1);
    await free(memberA, d1);
    await free(memberC, d1);
    await free(memberC, d2);
    await free(memberB, d2);

    ok(await host.client.rpc('lock_plan', { p_plan_id: planId, p_date_option_id: d1 }));
    expect(await queue(planId)).toEqual([memberC.id]);

    ok(await host.client.rpc('reopen_plan', { p_plan_id: planId }));
    ok(await host.client.rpc('lock_plan', { p_plan_id: planId, p_date_option_id: d2 }));

    // memberC has been waiting since the first lock and stays ahead of memberB,
    // who only turned up on the second. A re-lock re-decides who is in, never
    // who has been waiting longer.
    expect(await queue(planId)).toEqual([memberC.id, memberB.id]);
  });
});

describe('news reaches the list', () => {
  it('tells the people waiting that a plan was called off', async () => {
    const planId = await fullPlan();
    ok(await say(memberB, planId, 'pending'));

    ok(await host.client.rpc('cancel_plan', { p_plan_id: planId, p_reason: 'rained off' }));

    const told = ok(
      await bed.service
        .from('notifications')
        .select('user_id')
        .eq('type', 'plan_cancelled')
        .filter('data->>plan_id', 'eq', planId),
    ).map((n) => n.user_id);

    // Somebody waiting is waiting for news, and this is the news.
    expect(told.sort()).toEqual([memberA.id, memberB.id].sort());
  });

  it('tells them it is back on, without claiming they are in', async () => {
    const planId = await fullPlan();
    ok(await say(memberB, planId, 'pending'));
    ok(await host.client.rpc('cancel_plan', { p_plan_id: planId }));

    ok(await host.client.rpc('restore_plan', { p_plan_id: planId }));

    const told = ok(
      await bed.service
        .from('notifications')
        .select('user_id, body')
        .eq('type', 'plan_reopened')
        .filter('data->>plan_id', 'eq', planId),
    );

    expect(told.find((n) => n.user_id === memberA.id)!.body).toContain('still counted in');
    expect(told.find((n) => n.user_id === memberB.id)!.body).toContain('waiting list');
  });
});
