// PLA-20: max_people used to be decorative — written at create, read for
// display, enforced nowhere. These tests pin down the two halves of the fix:
// the enforce_plan_cap trigger, which no write path can go around, and
// lock_plan seating only as many people as the plan has room for.
//
// Mocked tests cannot reach any of this. The bug existed precisely because
// the cap lived in the database's blind spot.
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
}) {
  return ok(
    await host.client
      .from('plans')
      .insert({
        group_id: groupId,
        created_by: host.id,
        title: `cap-${opts.planType}-${opts.maxPeople ?? 'none'}`,
        plan_type: opts.planType,
        event_date: opts.planType === 'fixed' ? daysFromNow(7) : null,
        min_people: opts.minPeople ?? 2,
        max_people: opts.maxPeople,
      })
      .select('id')
      .single(),
  ).id;
}

const sayYes = (user: TestUser, planId: string) =>
  user.client
    .from('rsvps')
    .upsert(
      { plan_id: planId, user_id: user.id, response: 'yes' },
      { onConflict: 'plan_id,user_id' },
    );

const say = (user: TestUser, planId: string, response: 'yes' | 'no') =>
  user.client
    .from('rsvps')
    .upsert({ plan_id: planId, user_id: user.id, response }, { onConflict: 'plan_id,user_id' });

async function yesCount(planId: string): Promise<number> {
  const rows = ok(
    await bed.service.from('rsvps').select('user_id').eq('plan_id', planId).eq('response', 'yes'),
  );
  return rows.length;
}

beforeAll(async () => {
  [host, memberA, memberB, memberC] = await Promise.all([
    bed.createUser('Cap Host'),
    bed.createUser('Cap MemberA'),
    bed.createUser('Cap MemberB'),
    bed.createUser('Cap MemberC'),
  ]);
  const group = await bed.createGroup(host);
  groupId = group.id;
  await bed.join(groupId, memberA);
  await bed.join(groupId, memberB);
  await bed.join(groupId, memberC);
});

afterAll(() => bed.dispose());

describe('enforce_plan_cap', () => {
  it('refuses the yes that would exceed the cap', async () => {
    const planId = await createPlan({ planType: 'fixed', maxPeople: 2 });
    ok(await sayYes(host, planId));
    ok(await sayYes(memberA, planId));

    const { error } = await sayYes(memberB, planId);
    expect(error).not.toBeNull();
    // PostgREST's PTxyz convention maps the SQLSTATE to the HTTP status, so
    // the app can tell "full" from "broken" without string-matching.
    expect(error!.code).toBe('PT409');
    expect(error!.message).toContain('full');
    expect(await yesCount(planId)).toBe(2);
  });

  it('lets someone re-confirm a place they already hold on a full plan', async () => {
    const planId = await createPlan({ planType: 'fixed', maxPeople: 2 });
    ok(await sayYes(host, planId));
    ok(await sayYes(memberA, planId));

    // The app writes with upsert, so this runs INSERT ... ON CONFLICT DO
    // UPDATE and fires the trigger with the user's own 'yes' already on the
    // table. Counting yourself would make holding your seat an error.
    ok(await sayYes(memberA, planId));
    expect(await yesCount(planId)).toBe(2);
  });

  it('always allows declining, even when full', async () => {
    const planId = await createPlan({ planType: 'fixed', maxPeople: 2 });
    ok(await sayYes(host, planId));
    ok(await sayYes(memberA, planId));

    ok(await say(memberB, planId, 'no'));
    // And an existing attendee can still get out — the PLA-16 guarantee.
    ok(await say(memberA, planId, 'no'));
    expect(await yesCount(planId)).toBe(1);
  });

  it('refuses a no that tries to become a yes while full', async () => {
    const planId = await createPlan({ planType: 'fixed', maxPeople: 2 });
    ok(await say(memberC, planId, 'no'));
    ok(await sayYes(host, planId));
    ok(await sayYes(memberA, planId));

    const { error } = await say(memberC, planId, 'yes');
    expect(error?.code).toBe('PT409');
    expect(await yesCount(planId)).toBe(2);
  });

  it('frees the place when someone withdraws', async () => {
    const planId = await createPlan({ planType: 'fixed', maxPeople: 2 });
    ok(await sayYes(host, planId));
    ok(await sayYes(memberA, planId));
    expect((await sayYes(memberB, planId)).error?.code).toBe('PT409');

    ok(await memberA.client.from('rsvps').delete().eq('plan_id', planId).eq('user_id', memberA.id));

    ok(await sayYes(memberB, planId));
    expect(await yesCount(planId)).toBe(2);
  });

  it('treats a null cap as no limit', async () => {
    const planId = await createPlan({ planType: 'fixed', maxPeople: null });
    ok(await sayYes(host, planId));
    ok(await sayYes(memberA, planId));
    ok(await sayYes(memberB, planId));
    ok(await sayYes(memberC, planId));
    expect(await yesCount(planId)).toBe(4);
  });

  it('cannot be bypassed by writing someone else in', async () => {
    const planId = await createPlan({ planType: 'fixed', maxPeople: 2 });
    ok(await sayYes(host, planId));
    ok(await sayYes(memberA, planId));

    // RLS owns this one, not the cap trigger — but a cap you can dodge by
    // RSVPing on another person's behalf would be no cap at all.
    const { error } = await memberB.client
      .from('rsvps')
      .insert({ plan_id: planId, user_id: memberC.id, response: 'yes' });
    expect(error).not.toBeNull();
    expect(await yesCount(planId)).toBe(2);
  });
});

describe('lock_plan honours the cap', () => {
  async function flexiblePlanWithEveryoneFree(maxPeople: number | null) {
    const planId = await createPlan({ planType: 'flexible', maxPeople, minPeople: 2 });
    const optionId = ok(
      await host.client
        .from('plan_date_options')
        .insert({ plan_id: planId, date: daysFromNow(7).slice(0, 10) })
        .select('id')
        .single(),
    ).id;

    // Sequential, not Promise.all: seating is first-come-first-served on
    // date_availability.created_at, so the order has to be deterministic.
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

  it('seats only up to the cap, earliest availability first', async () => {
    const planId = await flexiblePlanWithEveryoneFree(2);

    const result = ok(await host.client.rpc('lock_plan', { p_plan_id: planId })) as {
      locked: boolean;
      notified: number;
    };
    expect(result.locked).toBe(true);
    expect(result.notified).toBe(2);

    const seated = ok(
      await bed.service.from('rsvps').select('user_id').eq('plan_id', planId).eq('response', 'yes'),
    ).map((r) => r.user_id);
    expect(seated).toHaveLength(2);
    expect(seated.sort()).toEqual([host.id, memberA.id].sort());
    // The two who missed out are not seated. Where they DO land — the waiting
    // list, in this same first-come order — is waitlist.test.ts (PLA-37).
    expect(seated).not.toContain(memberB.id);
    expect(seated).not.toContain(memberC.id);
  });

  it('notifies only the people it actually seated', async () => {
    const planId = await flexiblePlanWithEveryoneFree(2);
    ok(await host.client.rpc('lock_plan', { p_plan_id: planId }));

    const notified = ok(
      await bed.service
        .from('notifications')
        .select('user_id')
        .eq('type', 'plan_locked')
        .filter('data->>plan_id', 'eq', planId),
    ).map((n) => n.user_id);

    expect(notified.sort()).toEqual([host.id, memberA.id].sort());
  });

  it('still seats everyone when the plan is uncapped', async () => {
    const planId = await flexiblePlanWithEveryoneFree(null);
    const result = ok(await host.client.rpc('lock_plan', { p_plan_id: planId })) as {
      notified: number;
    };
    expect(result.notified).toBe(4);
    expect(await yesCount(planId)).toBe(4);
  });

  // reopen_plan deliberately leaves the yes rows standing, so a re-lock meets
  // people who already hold a seat. Discounting only the ones who are NOT free
  // on the new date is not enough: a holder who IS free can sort outside the
  // new top-N, hold a seat nobody counted, and make the newcomer chosen in
  // their place trip the trigger — which rolls back the host's entire lock.
  describe('re-locking after a reopen', () => {
    async function twoDatePlan(maxPeople: number) {
      const planId = await createPlan({ planType: 'flexible', maxPeople, minPeople: 2 });
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
      return { planId, d1: ok(early).id, d2: ok(late).id };
    }

    // Awaited one at a time by every caller: seating is first-come on
    // created_at, so the write order is the thing under test.
    async function free(user: TestUser, planId: string, optionId: string) {
      ok(
        await user.client.from('date_availability').insert({
          plan_id: planId,
          user_id: user.id,
          date_option_id: optionId,
          available: true,
        }),
      );
    }

    it('does not blow up when a holder sorts outside the new top-N', async () => {
      const { planId, d1, d2 } = await twoDatePlan(2);

      // D1: host, memberA.   D2: memberB (earlier), then host.
      await free(host, planId, d1);
      await free(memberA, planId, d1);
      await free(memberB, planId, d2);
      await free(host, planId, d2);

      const first = ok(await host.client.rpc('lock_plan', { p_plan_id: planId })) as {
        locked: boolean;
      };
      expect(first.locked).toBe(true);
      expect(await yesCount(planId)).toBe(2);

      ok(await host.client.rpc('reopen_plan', { p_plan_id: planId }));

      // memberB is first in line on D2, but host and memberA already hold both
      // seats. Before the fix this raised PT409 and left the plan open.
      const second = (await host.client.rpc('lock_plan', {
        p_plan_id: planId,
        p_date_option_id: d2,
      })) as { data: { locked: boolean } | null; error: { code?: string } | null };

      expect(second.error).toBeNull();
      expect(second.data?.locked).toBe(true);

      const plan = ok(
        await bed.service.from('plans').select('status').eq('id', planId).single(),
      );
      expect(plan.status).toBe('locked');
      expect(await yesCount(planId)).toBeLessThanOrEqual(2);
    });

    it('never revokes a seat, and never oversubscribes to hand one out', async () => {
      const { planId, d1, d2 } = await twoDatePlan(2);
      await free(host, planId, d1);
      await free(memberA, planId, d1);
      await free(memberB, planId, d2);
      await free(memberC, planId, d2);

      ok(await host.client.rpc('lock_plan', { p_plan_id: planId, p_date_option_id: d1 }));
      ok(await host.client.rpc('reopen_plan', { p_plan_id: planId }));
      ok(await host.client.rpc('lock_plan', { p_plan_id: planId, p_date_option_id: d2 }));

      // Both seats were already spent on D1's pair, so neither of D2's people
      // gets in — but nobody is thrown out either, and the cap holds.
      const seated = ok(
        await bed.service
          .from('rsvps')
          .select('user_id')
          .eq('plan_id', planId)
          .eq('response', 'yes'),
      ).map((r) => r.user_id);
      expect(seated).toHaveLength(2);
      expect(seated.sort()).toEqual([host.id, memberA.id].sort());
    });
  });

  it('leaves a locked plan at or under its cap', async () => {
    const planId = await flexiblePlanWithEveryoneFree(3);
    ok(await host.client.rpc('lock_plan', { p_plan_id: planId }));

    const plan = ok(
      await bed.service.from('plans').select('max_people, status').eq('id', planId).single(),
    );
    expect(plan.status).toBe('locked');
    expect(await yesCount(planId)).toBeLessThanOrEqual(plan.max_people!);
  });
});
