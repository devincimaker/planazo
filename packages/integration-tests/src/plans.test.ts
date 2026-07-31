// Plan lifecycle RPCs: lock_plan, reopen_plan, cancel_plan, restore_plan.
// All four are SECURITY DEFINER host actions — creator or group admin only.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestBed, TestUser, ok, daysFromNow } from './testbed';

const bed = new TestBed();
let host: TestUser;
let memberA: TestUser;
let memberB: TestUser;
let groupId: string;

async function createPlan(planType: 'fixed' | 'flexible', title: string, eventDate?: string) {
  return ok(
    await host.client
      .from('plans')
      .insert({
        group_id: groupId,
        created_by: host.id,
        title,
        plan_type: planType,
        event_date: eventDate ?? (planType === 'fixed' ? daysFromNow(7) : null),
        min_people: 2,
      })
      .select('id')
      .single(),
  ).id;
}

async function addOption(planId: string, date: string) {
  return ok(
    await host.client
      .from('plan_date_options')
      .insert({ plan_id: planId, date })
      .select('id')
      .single(),
  ).id;
}

async function markAvailable(user: TestUser, planId: string, optionId: string) {
  ok(
    await user.client.from('date_availability').insert({
      plan_id: planId,
      user_id: user.id,
      date_option_id: optionId,
      available: true,
    }),
  );
}

beforeAll(async () => {
  [host, memberA, memberB] = await Promise.all([
    bed.createUser('Plan Host'),
    bed.createUser('Plan MemberA'),
    bed.createUser('Plan MemberB'),
  ]);
  const group = await bed.createGroup(host);
  groupId = group.id;
  await bed.join(groupId, memberA);
  await bed.join(groupId, memberB);
});

afterAll(() => bed.dispose());

describe('lock_plan on a fixed plan', () => {
  it('refuses below minimum, then locks and notifies the yes-RSVPs', async () => {
    const planId = await createPlan('fixed', 'Fixed dinner');

    ok(await host.client.from('rsvps').insert({ plan_id: planId, user_id: host.id, response: 'yes' }));
    const below = ok(await host.client.rpc('lock_plan', { p_plan_id: planId })) as {
      locked: boolean;
      reason?: string;
    };
    expect(below).toEqual({ locked: false, reason: 'below_minimum' });

    ok(await memberA.client.from('rsvps').insert({ plan_id: planId, user_id: memberA.id, response: 'yes' }));
    const locked = ok(await host.client.rpc('lock_plan', { p_plan_id: planId })) as {
      locked: boolean;
      notified: number;
    };
    expect(locked.locked).toBe(true);
    expect(locked.notified).toBe(2);

    const plan = ok(
      await host.client.from('plans').select('status, locked_at').eq('id', planId).single(),
    );
    expect(plan.status).toBe('locked');
    expect(plan.locked_at).not.toBeNull();

    const confirms = ok(
      await memberA.client.from('notifications').select('*').eq('type', 'plan_locked'),
    ).filter((n) => (n.data as { plan_id?: string })?.plan_id === planId);
    expect(confirms).toHaveLength(1);
    expect(confirms[0].title).toBe('Plan Confirmed!');
    expect(confirms[0].body).toBe('"Fixed dinner" is happening!');

    // A plain member is not a host: authorization is checked before status.
    const denied = await memberB.client.rpc('lock_plan', { p_plan_id: planId });
    expect(denied.error?.message).toMatch(/Only the plan creator or a group admin/);

    const relock = await host.client.rpc('lock_plan', { p_plan_id: planId });
    expect(relock.error?.message).toMatch(/Plan is not open/);
  });

  it('freezes RSVPs once locked', async () => {
    const planId = await createPlan('fixed', 'Fixed brunch');
    ok(await host.client.from('rsvps').insert({ plan_id: planId, user_id: host.id, response: 'yes' }));
    ok(await memberA.client.from('rsvps').insert({ plan_id: planId, user_id: memberA.id, response: 'yes' }));
    ok(await host.client.rpc('lock_plan', { p_plan_id: planId }));

    const flipped = ok(
      await memberA.client
        .from('rsvps')
        .update({ response: 'no' })
        .eq('plan_id', planId)
        .eq('user_id', memberA.id)
        .select(),
    );
    expect(flipped).toEqual([]);
  });
});

describe('lock_plan on a flexible plan', () => {
  it('picks the most-available viable date (ties to the earlier one) and seeds yes-RSVPs', async () => {
    const planId = await createPlan('flexible', 'Flexible pizza night');
    const d1 = daysFromNow(5);
    const d2 = daysFromNow(6);
    const d3 = daysFromNow(8);
    const o1 = await addOption(planId, d1);
    const o2 = await addOption(planId, d2);
    const o3 = await addOption(planId, d3);

    // d2 and d3 both reach 2; the tie must break to the earlier date.
    await markAvailable(memberA, planId, o2);
    await markAvailable(memberB, planId, o2);
    await markAvailable(memberA, planId, o3);
    await markAvailable(host, planId, o3);

    // An explicitly chosen non-viable option is not lockable.
    const nonViable = ok(
      await host.client.rpc('lock_plan', { p_plan_id: planId, p_date_option_id: o1 }),
    ) as { locked: boolean; reason?: string };
    expect(nonViable).toEqual({ locked: false, reason: 'no_viable_date' });

    const res = ok(await host.client.rpc('lock_plan', { p_plan_id: planId })) as {
      locked: boolean;
      locked_date: string;
      notified: number;
    };
    expect(res.locked).toBe(true);
    expect(new Date(res.locked_date).getTime()).toBe(new Date(d2).getTime());
    expect(res.notified).toBe(2);

    // Availability on the locked date became attendance; the host (only
    // available on d3) is not converted.
    const rsvps = ok(await host.client.from('rsvps').select('user_id, response').eq('plan_id', planId));
    expect(rsvps.map((r) => r.user_id).sort()).toEqual([memberA.id, memberB.id].sort());
    expect(rsvps.every((r) => r.response === 'yes')).toBe(true);

    // reopen_plan: member denied, host returns the plan to an open vote.
    const denied = await memberA.client.rpc('reopen_plan', { p_plan_id: planId });
    expect(denied.error?.message).toMatch(/Only the plan creator or a group admin/);

    expect(ok(await host.client.rpc('reopen_plan', { p_plan_id: planId }))).toEqual({ reopened: true });
    const plan = ok(
      await host.client
        .from('plans')
        .select('status, locked_date, locked_at')
        .eq('id', planId)
        .single(),
    );
    expect(plan).toEqual({ status: 'open', locked_date: null, locked_at: null });
  });

  it('only flexible plans can reopen the vote', async () => {
    const planId = await createPlan('fixed', 'Fixed for reopen guard');
    ok(await host.client.from('rsvps').insert({ plan_id: planId, user_id: host.id, response: 'yes' }));
    ok(await memberA.client.from('rsvps').insert({ plan_id: planId, user_id: memberA.id, response: 'yes' }));
    ok(await host.client.rpc('lock_plan', { p_plan_id: planId }));

    const res = await host.client.rpc('reopen_plan', { p_plan_id: planId });
    expect(res.error?.message).toMatch(/Only flexible plans/);
  });
});

describe('cancel_plan and restore_plan', () => {
  it('stamps who/when/why, notifies everyone in except the canceller, and restores', async () => {
    const planId = await createPlan('flexible', 'Cancel target');
    const o1 = await addOption(planId, daysFromNow(6));
    await markAvailable(host, planId, o1);
    await markAvailable(memberA, planId, o1);
    await markAvailable(memberB, planId, o1);

    const denied = await memberB.client.rpc('cancel_plan', { p_plan_id: planId });
    expect(denied.error?.message).toMatch(/Only the plan creator or a group admin/);

    const res = ok(
      await host.client.rpc('cancel_plan', { p_plan_id: planId, p_reason: '  running late  ' }),
    ) as { cancelled: boolean; notified: number };
    expect(res.cancelled).toBe(true);
    expect(res.notified).toBe(2);

    const plan = ok(
      await host.client
        .from('plans')
        .select('status, cancelled_at, cancelled_by, cancel_reason')
        .eq('id', planId)
        .single(),
    );
    expect(plan.status).toBe('cancelled');
    expect(plan.cancelled_at).not.toBeNull();
    expect(plan.cancelled_by).toBe(host.id);
    expect(plan.cancel_reason).toBe('running late');

    const notices = ok(
      await memberA.client.from('notifications').select('*').eq('type', 'plan_cancelled'),
    ).filter((n) => (n.data as { plan_id?: string })?.plan_id === planId);
    expect(notices).toHaveLength(1);
    expect(notices[0].title).toBe('Called off');
    expect(notices[0].body).toBe('Plan Host called off "Cancel target" — "running late"');

    const again = ok(await host.client.rpc('cancel_plan', { p_plan_id: planId })) as {
      cancelled: boolean;
      already_cancelled?: boolean;
    };
    expect(again.already_cancelled).toBe(true);

    // Restore: this plan never locked, so it returns to an open vote.
    const restored = ok(await host.client.rpc('restore_plan', { p_plan_id: planId })) as {
      restored: boolean;
      status: string;
      notified: number;
    };
    expect(restored).toEqual({ restored: true, status: 'open', notified: 2 });

    const back = ok(
      await host.client
        .from('plans')
        .select('status, cancelled_at, cancelled_by, cancel_reason')
        .eq('id', planId)
        .single(),
    );
    expect(back).toEqual({ status: 'open', cancelled_at: null, cancelled_by: null, cancel_reason: null });

    const reopenNotices = ok(
      await memberA.client.from('notifications').select('*').eq('type', 'plan_reopened'),
    ).filter((n) => (n.data as { plan_id?: string })?.plan_id === planId);
    expect(reopenNotices).toHaveLength(1);
    expect(reopenNotices[0].title).toBe('Back on');
    expect(reopenNotices[0].body).toBe('"Cancel target" is back on — your dates still stand.');

    const notCancelled = await host.client.rpc('restore_plan', { p_plan_id: planId });
    expect(notCancelled.error?.message).toMatch(/Plan is not cancelled/);
  });

  it('restores a locked flexible plan back to locked', async () => {
    const planId = await createPlan('flexible', 'Locked restore target');
    const o1 = await addOption(planId, daysFromNow(6));
    await markAvailable(host, planId, o1);
    await markAvailable(memberA, planId, o1);

    ok(await host.client.rpc('lock_plan', { p_plan_id: planId }));
    ok(await host.client.rpc('cancel_plan', { p_plan_id: planId }));

    const restored = ok(await host.client.rpc('restore_plan', { p_plan_id: planId })) as {
      status: string;
    };
    expect(restored.status).toBe('locked');
  });

  it('refuses to restore once the date is more than a day past', async () => {
    const planId = await createPlan('fixed', 'Long gone', daysFromNow(-3));
    ok(await host.client.rpc('cancel_plan', { p_plan_id: planId }));

    const res = await host.client.rpc('restore_plan', { p_plan_id: planId });
    expect(res.error?.message).toMatch(/The date has passed/);
  });
});
