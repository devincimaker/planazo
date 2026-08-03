// Plan lifecycle RPCs: lock_plan, reopen_plan, cancel_plan, restore_plan.
// All four are SECURITY DEFINER host actions — creator or group admin only.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestBed, TestUser, ok, daysFromNow } from './testbed';

const bed = new TestBed();
let host: TestUser;
let memberA: TestUser;
let memberB: TestUser;
let groupId: string;

async function createPlanAs(
  user: TestUser,
  gid: string,
  planType: 'fixed' | 'flexible',
  title: string,
  eventDate?: string,
) {
  return ok(
    await user.client
      .from('plans')
      .insert({
        group_id: gid,
        created_by: user.id,
        title,
        plan_type: planType,
        event_date: eventDate ?? (planType === 'fixed' ? daysFromNow(7) : null),
        min_people: 2,
      })
      .select('id')
      .single(),
  ).id;
}

async function createPlan(planType: 'fixed' | 'flexible', title: string, eventDate?: string) {
  return createPlanAs(host, groupId, planType, title, eventDate);
}

async function addOptionAs(user: TestUser, planId: string, date: string) {
  return ok(
    await user.client
      .from('plan_date_options')
      .insert({ plan_id: planId, date })
      .select('id')
      .single(),
  ).id;
}

async function addOption(planId: string, date: string) {
  return addOptionAs(host, planId, date);
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

  // Locking used to freeze RSVPs outright (PLA-16). It can't: the lock seeds
  // every available member into a 'yes' they never tapped, so freezing at that
  // moment is what trapped people. A locked plan stays answerable.
  it('leaves attendees free to change their mind once locked', async () => {
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
    expect(flipped).toHaveLength(1);
    expect(flipped[0].response).toBe('no');
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
    expect(notices[0].body).toBe('Plan Host called off "Cancel target": "running late"');

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
    expect(reopenNotices[0].body).toBe('"Cancel target" is back on. Your dates still stand.');

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

// PLA-42: created_by is not a standing permission. Removal takes away the
// membership row, the RSVPs and the ability to read the group — but the
// lifecycle RPCs are SECURITY DEFINER, so RLS never runs inside them, and
// `created_by = auth.uid()` went on being true forever. A removed person keeps
// their JWT and needs nothing but the plan's UUID, which a push notification,
// a deep link or a screenshot already gave them.
describe('host powers end with membership', () => {
  const denied = /Only the plan creator or a group admin/;

  let admin: TestUser;
  let creator: TestUser;
  let bystander: TestUser;
  let gid: string;
  let fixedPlan: string;
  let flexPlan: string;
  let cancelledPlan: string;
  let deletablePlan: string;

  beforeAll(async () => {
    [admin, creator, bystander] = await Promise.all([
      bed.createUser('Exile Admin'),
      bed.createUser('Exile Creator'),
      bed.createUser('Exile Bystander'),
    ]);
    // The creator joins as a plain member on purpose. The file's own `host` is
    // the group's admin, so it satisfies the admin half of every guard and
    // would hide this bug completely.
    gid = (await bed.createGroup(admin)).id;
    await bed.join(gid, creator);
    await bed.join(gid, bystander);

    fixedPlan = await createPlanAs(creator, gid, 'fixed', 'Exile fixed');
    deletablePlan = await createPlanAs(creator, gid, 'fixed', 'Exile deletable');
    cancelledPlan = await createPlanAs(creator, gid, 'fixed', 'Exile cancelled');
    flexPlan = await createPlanAs(creator, gid, 'flexible', 'Exile flexible');

    // Two yes-RSVPs from people who stay, so lock_plan would genuinely lock if
    // the guard let it through. RSVPs from the creator would not survive the
    // removal — the on_group_member_delete trigger clears them — and the call
    // would stall on below_minimum for the wrong reason.
    for (const u of [admin, bystander]) {
      ok(
        await u.client.from('rsvps').insert({ plan_id: fixedPlan, user_id: u.id, response: 'yes' }),
      );
    }

    const option = await addOptionAs(creator, flexPlan, daysFromNow(6));
    await markAvailable(admin, flexPlan, option);
    await markAvailable(bystander, flexPlan, option);
    ok(await admin.client.rpc('lock_plan', { p_plan_id: flexPlan }));
    ok(await admin.client.rpc('cancel_plan', { p_plan_id: cancelledPlan }));

    // The removal itself, exactly as group/[id]/manage.tsx does it.
    ok(
      await admin.client
        .from('group_members')
        .delete()
        .eq('group_id', gid)
        .eq('user_id', creator.id),
    );
  });

  it('refuses every lifecycle RPC to a removed creator', async () => {
    expect((await creator.client.rpc('lock_plan', { p_plan_id: fixedPlan })).error?.message).toMatch(denied);
    expect((await creator.client.rpc('cancel_plan', { p_plan_id: fixedPlan })).error?.message).toMatch(denied);
    expect((await creator.client.rpc('reopen_plan', { p_plan_id: flexPlan })).error?.message).toMatch(denied);
    expect((await creator.client.rpc('restore_plan', { p_plan_id: cancelledPlan })).error?.message).toMatch(denied);

    const states = ok(
      await admin.client
        .from('plans')
        .select('id, status')
        .in('id', [fixedPlan, flexPlan, cancelledPlan]),
    );
    expect(Object.fromEntries(states.map((p) => [p.id, p.status]))).toEqual({
      [fixedPlan]: 'open',
      [flexPlan]: 'locked',
      [cancelledPlan]: 'cancelled',
    });
  });

  it('refuses the direct writes too: rename, delete, extra dates', async () => {
    // No .select() on the writes. PostgREST only adds RETURNING when you ask
    // for the row back, and without RETURNING the SELECT policy never runs —
    // so "they cannot read the plan" is not the protection here. The UPDATE
    // and DELETE policies have to stop this on their own.
    await creator.client
      .from('plans')
      .update({ title: 'Renamed from outside' })
      .eq('id', fixedPlan);
    expect(ok(await admin.client.from('plans').select('title').eq('id', fixedPlan).single()).title).toBe(
      'Exile fixed',
    );

    await creator.client.from('plans').delete().eq('id', deletablePlan);
    expect(ok(await admin.client.from('plans').select('id').eq('id', deletablePlan))).toHaveLength(1);

    await creator.client.from('plan_date_options').insert({ plan_id: flexPlan, date: daysFromNow(9) });
    expect(ok(await admin.client.from('plan_date_options').select('id').eq('plan_id', flexPlan))).toHaveLength(1);
  });

  it('holds for leaving voluntarily, which is the common case', async () => {
    const leaver = await bed.createUser('Exile Leaver');
    await bed.join(gid, leaver);
    const planId = await createPlanAs(leaver, gid, 'fixed', 'Exile leaver plan');

    ok(await leaver.client.rpc('leave_group', { p_group_id: gid }));

    expect((await leaver.client.rpc('cancel_plan', { p_plan_id: planId })).error?.message).toMatch(denied);
    await leaver.client.from('plans').update({ title: 'Renamed on the way out' }).eq('id', planId);

    const plan = ok(await admin.client.from('plans').select('status, title').eq('id', planId).single());
    expect(plan).toEqual({ status: 'open', title: 'Exile leaver plan' });
  });

  // The other half of the guard, and the half that is easy to break: requiring
  // membership must not cost a plain member the plans they host.
  it('leaves current members their host powers, and rejoining hands them back', async () => {
    const planId = await createPlanAs(bystander, gid, 'fixed', 'Bystander plan');

    // bystander created it and is no admin — the creator branch, on its own.
    ok(await bystander.client.rpc('cancel_plan', { p_plan_id: planId }));
    expect(ok(await admin.client.from('plans').select('status').eq('id', planId).single()).status).toBe(
      'cancelled',
    );

    // admin did not create it — the admin branch, on its own.
    ok(await admin.client.rpc('restore_plan', { p_plan_id: planId }));
    expect(ok(await admin.client.from('plans').select('status').eq('id', planId).single()).status).toBe(
      'open',
    );

    // Nobody deletes a plan from the client now, host or admin or neither: the
    // privilege is revoked outright, so this is 42501 rather than a quiet
    // no-op. Ending a plan is cancel_plan, which leaves a record and tells
    // everyone who was in.
    const hardDelete = await admin.client.from('plans').delete().eq('id', planId);
    expect(hardDelete.error?.code).toBe('42501');
    expect(ok(await admin.client.from('plans').select('id').eq('id', planId))).toHaveLength(1);

    // And the exile's powers come back with their membership.
    await bed.join(gid, creator);
    ok(await creator.client.rpc('cancel_plan', { p_plan_id: fixedPlan }));
    expect(ok(await admin.client.from('plans').select('status').eq('id', fixedPlan).single()).status).toBe(
      'cancelled',
    );
  });
});
