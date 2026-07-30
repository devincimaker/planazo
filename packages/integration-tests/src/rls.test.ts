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
