// RLS policies as seen by real authenticated clients. The motivating bug for
// this suite: pending invitees were blocked from reading the invited group's
// name (fixed in 20260729000002) — mocked tests can't see policy behavior.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestBed, TestUser, ok, daysFromNow } from './testbed';

const bed = new TestBed();
let owner: TestUser;
let member: TestUser;
let invitee: TestUser;
let outsider: TestUser;
let group: { id: string; name: string };
let planId: string;

beforeAll(async () => {
  [owner, member, invitee, outsider] = await Promise.all([
    bed.createUser('Rls Owner'),
    bed.createUser('Rls Member'),
    bed.createUser('Rls Invitee'),
    bed.createUser('Rls Outsider'),
  ]);
  group = await bed.createGroup(owner);
  await bed.join(group.id, member);
  planId = ok(
    await owner.client
      .from('plans')
      .insert({
        group_id: group.id,
        created_by: owner.id,
        title: 'RLS probe plan',
        plan_type: 'fixed',
        event_date: daysFromNow(7),
        min_people: 2,
      })
      .select('id')
      .single(),
  ).id;
});

afterAll(() => bed.dispose());

describe('groups and memberships', () => {
  it('a pending invitee can read the invited group name and its members', async () => {
    ok(await owner.client.rpc('invite_to_group', { p_group_id: group.id, p_invitee: invitee.id }));

    const groups = ok(await invitee.client.from('groups').select('name').eq('id', group.id));
    expect(groups).toEqual([{ name: group.name }]);

    const members = ok(
      await invitee.client.from('group_members').select('user_id').eq('group_id', group.id),
    );
    expect(members.map((m) => m.user_id).sort()).toEqual([owner.id, member.id].sort());
  });

  it('an outsider sees no trace of the group', async () => {
    expect(ok(await outsider.client.from('groups').select('id').eq('id', group.id))).toEqual([]);
    expect(
      ok(await outsider.client.from('group_members').select('id').eq('group_id', group.id)),
    ).toEqual([]);
  });
});

// PLA-35: group_members INSERT used to be WITH CHECK (auth.uid() = user_id) —
// "the row is about you" and nothing more. Knowing a group UUID was enough to
// walk in, and `role` was whatever you typed. These pin the replacement: no
// INSERT policy at all, and three SECURITY DEFINER functions that pick the
// role themselves.
describe('group_members INSERT is server-side only', () => {
  it('an outsider cannot insert themselves into a group they know the id of', async () => {
    const denied = await outsider.client
      .from('group_members')
      .insert({ group_id: group.id, user_id: outsider.id, role: 'member' });
    expect(denied.error?.message).toMatch(/row-level security/);

    // Still not a member, by the service role's unfiltered view.
    expect(
      ok(
        await bed.service
          .from('group_members')
          .select('id')
          .eq('group_id', group.id)
          .eq('user_id', outsider.id),
      ),
    ).toEqual([]);
  });

  it('a member cannot promote themselves by inserting a second admin row', async () => {
    const denied = await member.client
      .from('group_members')
      .insert({ group_id: group.id, user_id: member.id, role: 'admin' });
    expect(denied.error?.message).toMatch(/row-level security/);

    const roles = ok(
      await bed.service
        .from('group_members')
        .select('role')
        .eq('group_id', group.id)
        .eq('user_id', member.id),
    );
    expect(roles).toEqual([{ role: 'member' }]);
  });

  it('a client cannot create a group row directly either', async () => {
    const denied = await outsider.client.from('groups').insert({
      name: 'Orphan by hand',
      invite_code: 'ZZZZ2345',
      created_by: outsider.id,
    });
    expect(denied.error?.message).toMatch(/row-level security/);
  });
});

describe('create_group and join_group_by_invite_code', () => {
  it('create_group seats the caller as the sole admin, atomically', async () => {
    const created = ok(
      await outsider.client.rpc('create_group', {
        p_name: '  Rls Created Group  ',
        p_description: '  from the rpc  ',
      }),
    );
    bed.trackGroup(created.id);

    expect(created.name).toBe('Rls Created Group');
    expect(created.description).toBe('from the rpc');
    expect(created.created_by).toBe(outsider.id);
    expect(created.invite_code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    // No colour passed: the server falls back to the same hash the app uses.
    expect(created.color).toMatch(/^#[0-9A-F]{6}$/i);

    const members = ok(
      await outsider.client.from('group_members').select('user_id, role').eq('group_id', created.id),
    );
    expect(members).toEqual([{ user_id: outsider.id, role: 'admin' }]);
  });

  it('create_group refuses a blank name', async () => {
    const denied = await outsider.client.rpc('create_group', { p_name: '   ' });
    expect(denied.error?.message).toMatch(/A group needs a name/);
  });

  it('joining by code always lands as member, never admin', async () => {
    const created = ok(await owner.client.rpc('create_group', { p_name: 'Rls Join Target' }));
    bed.trackGroup(created.id);

    // Lower-cased and padded, the way a pasted code arrives.
    const joined = ok(
      await outsider.client.rpc('join_group_by_invite_code', {
        p_code: `  ${created.invite_code.toLowerCase()} `,
      }),
    ) as { status: string; group_id: string; name: string };
    expect(joined).toEqual({
      status: 'joined',
      group_id: created.id,
      name: 'Rls Join Target',
    });

    const mine = ok(
      await outsider.client
        .from('group_members')
        .select('role')
        .eq('group_id', created.id)
        .eq('user_id', outsider.id)
        .single(),
    );
    expect(mine.role).toBe('member');
  });

  it('a bad code and a second join report themselves instead of throwing', async () => {
    const created = ok(await owner.client.rpc('create_group', { p_name: 'Rls Rejoin Target' }));
    bed.trackGroup(created.id);

    expect(
      ok(await outsider.client.rpc('join_group_by_invite_code', { p_code: 'NOTACODE' })),
    ).toEqual({ status: 'not_found' });

    ok(await outsider.client.rpc('join_group_by_invite_code', { p_code: created.invite_code }));
    expect(
      ok(await outsider.client.rpc('join_group_by_invite_code', { p_code: created.invite_code })),
    ).toEqual({ status: 'already_member', group_id: created.id, name: 'Rls Rejoin Target' });

    // And the repeat did not mint a duplicate row.
    expect(
      ok(
        await bed.service
          .from('group_members')
          .select('id')
          .eq('group_id', created.id)
          .eq('user_id', outsider.id),
      ),
    ).toHaveLength(1);
  });
});

describe('plans', () => {
  it('members can read plans, outsiders cannot', async () => {
    expect(ok(await member.client.from('plans').select('id').eq('id', planId))).toHaveLength(1);
    expect(ok(await outsider.client.from('plans').select('id').eq('id', planId))).toEqual([]);
  });

  it('anyone_can_post=false blocks member plan INSERT but not admin', async () => {
    ok(await owner.client.from('groups').update({ anyone_can_post: false }).eq('id', group.id));

    const denied = await member.client.from('plans').insert({
      group_id: group.id,
      created_by: member.id,
      title: 'Member post attempt',
      plan_type: 'fixed',
      event_date: daysFromNow(7),
    });
    expect(denied.error?.message).toMatch(/row-level security/);

    ok(
      await owner.client.from('plans').insert({
        group_id: group.id,
        created_by: owner.id,
        title: 'Admin post while restricted',
        plan_type: 'fixed',
        event_date: daysFromNow(7),
      }),
    );

    ok(await owner.client.from('groups').update({ anyone_can_post: true }).eq('id', group.id));
    ok(
      await member.client.from('plans').insert({
        group_id: group.id,
        created_by: member.id,
        title: 'Member post allowed again',
        plan_type: 'fixed',
        event_date: daysFromNow(7),
      }),
    );
  });
});

// PLA-16: rsvps shipped with INSERT/UPDATE/SELECT and no DELETE policy, so
// every "Change" in the app deleted nothing and reported success. These pin
// the rule that replaced it: your own row, on a plan that is still live.
describe('rsvps', () => {
  /** A fixed plan of this group, min 2, a week out. */
  async function freshPlan(title: string): Promise<string> {
    return ok(
      await owner.client
        .from('plans')
        .insert({
          group_id: group.id,
          created_by: owner.id,
          title,
          plan_type: 'fixed',
          event_date: daysFromNow(7),
          min_people: 2,
        })
        .select('id')
        .single(),
    ).id;
  }

  /** Both actors say yes, then the owner locks — the state that trapped people. */
  async function lockedPlan(title: string): Promise<string> {
    const id = await freshPlan(title);
    ok(await owner.client.from('rsvps').insert({ plan_id: id, user_id: owner.id, response: 'yes' }));
    ok(await member.client.from('rsvps').insert({ plan_id: id, user_id: member.id, response: 'yes' }));
    ok(await owner.client.rpc('lock_plan', { p_plan_id: id }));
    return id;
  }

  it('an answer on an open plan can be withdrawn', async () => {
    const planId = await freshPlan('Rsvp open plan');
    ok(await member.client.from('rsvps').insert({ plan_id: planId, user_id: member.id, response: 'no' }));

    const cleared = ok(
      await member.client
        .from('rsvps')
        .delete()
        .eq('plan_id', planId)
        .eq('user_id', member.id)
        .select(),
    );
    expect(cleared).toHaveLength(1);
    expect(
      ok(await member.client.from('rsvps').select('id').eq('plan_id', planId).eq('user_id', member.id)),
    ).toEqual([]);
  });

  it('a locked plan can still be flipped and withdrawn from', async () => {
    const planId = await lockedPlan('Rsvp locked plan');

    const flipped = ok(
      await member.client
        .from('rsvps')
        .update({ response: 'no' })
        .eq('plan_id', planId)
        .eq('user_id', member.id)
        .select(),
    );
    expect(flipped).toHaveLength(1);
    expect(flipped[0].response).toBe('no');

    const withdrawn = ok(
      await member.client
        .from('rsvps')
        .delete()
        .eq('plan_id', planId)
        .eq('user_id', member.id)
        .select(),
    );
    expect(withdrawn).toHaveLength(1);

    // And back in — withdrawing can't be a one-way door either.
    ok(await member.client.from('rsvps').insert({ plan_id: planId, user_id: member.id, response: 'yes' }));
  });

  it("nobody can touch someone else's answer", async () => {
    const planId = await freshPlan('Rsvp foreign row');
    ok(await owner.client.from('rsvps').insert({ plan_id: planId, user_id: owner.id, response: 'yes' }));

    const deleted = ok(
      await member.client
        .from('rsvps')
        .delete()
        .eq('plan_id', planId)
        .eq('user_id', owner.id)
        .select(),
    );
    expect(deleted).toEqual([]);

    const flipped = ok(
      await member.client
        .from('rsvps')
        .update({ response: 'no' })
        .eq('plan_id', planId)
        .eq('user_id', owner.id)
        .select(),
    );
    expect(flipped).toEqual([]);

    const untouched = ok(
      await owner.client
        .from('rsvps')
        .select('response')
        .eq('plan_id', planId)
        .eq('user_id', owner.id)
        .single(),
    );
    expect(untouched.response).toBe('yes');
  });

  it('an outsider cannot answer a plan they cannot see', async () => {
    const planId = await freshPlan('Rsvp outsider probe');
    const denied = await outsider.client
      .from('rsvps')
      .insert({ plan_id: planId, user_id: outsider.id, response: 'yes' });
    expect(denied.error?.message).toMatch(/row-level security/);
  });

  it('a cancelled plan is frozen — answers stand as a record', async () => {
    const planId = await freshPlan('Rsvp cancelled plan');
    ok(await member.client.from('rsvps').insert({ plan_id: planId, user_id: member.id, response: 'yes' }));
    ok(await owner.client.rpc('cancel_plan', { p_plan_id: planId }));

    const deleted = ok(
      await member.client
        .from('rsvps')
        .delete()
        .eq('plan_id', planId)
        .eq('user_id', member.id)
        .select(),
    );
    expect(deleted).toEqual([]);

    const flipped = ok(
      await member.client
        .from('rsvps')
        .update({ response: 'no' })
        .eq('plan_id', planId)
        .eq('user_id', member.id)
        .select(),
    );
    expect(flipped).toEqual([]);
  });
});

describe('notifications', () => {
  it('are visible and updatable by their owner only', async () => {
    // Plan INSERTs above fanned plan_created out to the member.
    const own = ok(await member.client.from('notifications').select('*'));
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((n) => n.user_id === member.id)).toBe(true);

    const target = own[0];
    // The owner of the plan cannot touch the member's notification.
    const foreign = ok(
      await owner.client.from('notifications').update({ read: true }).eq('id', target.id).select(),
    );
    expect(foreign).toEqual([]);

    const mine = ok(
      await member.client.from('notifications').update({ read: true }).eq('id', target.id).select(),
    );
    expect(mine).toHaveLength(1);
    expect(mine[0].read).toBe(true);
  });

  it('cannot be inserted by authenticated users, only the service role', async () => {
    const denied = await member.client.from('notifications').insert({
      user_id: member.id,
      type: 'plan_created',
      title: 'forged',
      body: 'forged',
    });
    expect(denied.error?.message).toMatch(/row-level security/);
  });
});

describe('feedback', () => {
  it('is write-only: own inserts succeed, impersonation and reads fail', async () => {
    ok(
      await member.client.from('feedback').insert({
        user_id: member.id,
        kind: 'other',
        message: 'integration test feedback',
      }),
    );

    const forged = await member.client.from('feedback').insert({
      user_id: owner.id,
      kind: 'other',
      message: 'not mine',
    });
    expect(forged.error?.message).toMatch(/row-level security/);

    expect(ok(await member.client.from('feedback').select('id'))).toEqual([]);
  });
});
