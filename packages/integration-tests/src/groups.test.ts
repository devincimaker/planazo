// Group RPCs: invite_to_group / respond_group_invite, leave_group (with its
// cleanup trigger, admin handoff and empty-group deletion), set_group_notify,
// and the invite-code lookup non-members use to join.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestBed, TestUser, ok, daysFromNow } from './testbed';

const bed = new TestBed();
let admin: TestUser;
let early: TestUser;
let late: TestUser;
let loner: TestUser;
let group: { id: string; name: string; invite_code: string };

beforeAll(async () => {
  [admin, early, late, loner] = await Promise.all([
    bed.createUser('Grp Admin'),
    bed.createUser('Grp Early'),
    bed.createUser('Grp Late'),
    bed.createUser('Grp Loner'),
  ]);
  group = await bed.createGroup(admin);
  await bed.join(group.id, early);
  await bed.join(group.id, late);
});

afterAll(() => bed.dispose());

describe('set_group_notify', () => {
  it('flips only the caller’s membership pref; non-members are refused', async () => {
    ok(await early.client.rpc('set_group_notify', { p_group_id: group.id, p_notify: false }));
    const rows = ok(
      await early.client
        .from('group_members')
        .select('user_id, notify_new_plans')
        .eq('group_id', group.id),
    );
    expect(rows.find((r) => r.user_id === early.id)?.notify_new_plans).toBe(false);
    expect(rows.find((r) => r.user_id === admin.id)?.notify_new_plans).toBe(true);

    const denied = await loner.client.rpc('set_group_notify', { p_group_id: group.id, p_notify: false });
    expect(denied.error?.message).toMatch(/Not a member of this group/);
  });
});

describe('invite_to_group and respond_group_invite', () => {
  it('walks the invite lifecycle including the stale-row reset', async () => {
    // Only members can invite.
    const outsiderInvite = await loner.client.rpc('invite_to_group', {
      p_group_id: group.id,
      p_invitee: early.id,
    });
    expect(outsiderInvite.error?.message).toMatch(/Only members can invite/);

    // Inviting an existing member short-circuits.
    expect(
      ok(await admin.client.rpc('invite_to_group', { p_group_id: group.id, p_invitee: early.id })),
    ).toEqual({ status: 'already_member' });

    // Fresh invite, then a duplicate.
    expect(
      ok(await admin.client.rpc('invite_to_group', { p_group_id: group.id, p_invitee: loner.id })),
    ).toEqual({ status: 'invited' });
    expect(
      ok(await admin.client.rpc('invite_to_group', { p_group_id: group.id, p_invitee: loner.id })),
    ).toEqual({ status: 'already_invited' });

    const invite = ok(
      await loner.client.from('group_invites').select('id').eq('invitee_id', loner.id).single(),
    );

    // Only the invitee may respond.
    const foreign = await early.client.rpc('respond_group_invite', {
      p_invite_id: invite.id,
      p_accept: true,
    });
    expect(foreign.error?.message).toMatch(/Invite not found/);

    const accepted = ok(
      await loner.client.rpc('respond_group_invite', { p_invite_id: invite.id, p_accept: true }),
    ) as { status: string; group_id: string };
    expect(accepted).toEqual({ status: 'accepted', group_id: group.id });

    const membership = ok(
      await loner.client
        .from('group_members')
        .select('role')
        .eq('group_id', group.id)
        .eq('user_id', loner.id)
        .single(),
    );
    expect(membership.role).toBe('member');

    // Responding again is a no-op that reports the settled status.
    expect(
      ok(await loner.client.rpc('respond_group_invite', { p_invite_id: invite.id, p_accept: false })),
    ).toEqual({ status: 'accepted', group_id: group.id });
  });

  it('leaving cleans the leaver’s RSVPs and availability, and stale invites reset to pending', async () => {
    const planId = ok(
      await admin.client
        .from('plans')
        .insert({
          group_id: group.id,
          created_by: admin.id,
          title: 'Leave cleanup probe',
          plan_type: 'flexible',
          min_people: 2,
        })
        .select('id')
        .single(),
    ).id;
    const optionId = ok(
      await admin.client
        .from('plan_date_options')
        .insert({ plan_id: planId, date: daysFromNow(6) })
        .select('id')
        .single(),
    ).id;

    for (const u of [loner, early]) {
      ok(
        await u.client.from('date_availability').insert({
          plan_id: planId,
          user_id: u.id,
          date_option_id: optionId,
          available: true,
        }),
      );
      ok(await u.client.from('rsvps').insert({ plan_id: planId, user_id: u.id, response: 'yes' }));
    }

    expect(ok(await loner.client.rpc('leave_group', { p_group_id: group.id }))).toMatchObject({
      left: true,
    });

    // The leaver's rows are gone, the remaining member's survive.
    const rsvps = ok(await bed.service.from('rsvps').select('user_id').eq('plan_id', planId));
    expect(rsvps.map((r) => r.user_id)).toEqual([early.id]);
    const avail = ok(await bed.service.from('date_availability').select('user_id').eq('plan_id', planId));
    expect(avail.map((a) => a.user_id)).toEqual([early.id]);
    expect(ok(await loner.client.from('groups').select('id').eq('id', group.id))).toEqual([]);

    // The old accepted invite row resets to pending instead of erroring.
    expect(
      ok(await admin.client.rpc('invite_to_group', { p_group_id: group.id, p_invitee: loner.id })),
    ).toEqual({ status: 'invited' });

    const invite = ok(
      await loner.client.from('group_invites').select('id, status').eq('invitee_id', loner.id).single(),
    );
    expect(invite.status).toBe('pending');
    expect(
      ok(await loner.client.rpc('respond_group_invite', { p_invite_id: invite.id, p_accept: false })),
    ).toMatchObject({ status: 'ignored' });

    // An ignored row also resets.
    expect(
      ok(await admin.client.rpc('invite_to_group', { p_group_id: group.id, p_invitee: loner.id })),
    ).toEqual({ status: 'invited' });
  });
});

describe('leave_group admin handoff', () => {
  it('promotes the longest-standing member when the last admin leaves, deletes the group when empty', async () => {
    const g2 = await bed.createGroup(admin, { name: 'Handoff group' });
    await bed.join(g2.id, early);
    await bed.join(g2.id, late);

    const res = ok(await admin.client.rpc('leave_group', { p_group_id: g2.id })) as {
      left: boolean;
      promoted: string | null;
    };
    expect(res.promoted).toBe(early.id);

    const roles = ok(
      await early.client.from('group_members').select('user_id, role').eq('group_id', g2.id),
    );
    expect(roles.find((r) => r.user_id === early.id)?.role).toBe('admin');
    expect(roles.find((r) => r.user_id === late.id)?.role).toBe('member');

    ok(await late.client.rpc('leave_group', { p_group_id: g2.id }));
    expect(ok(await early.client.rpc('leave_group', { p_group_id: g2.id }))).toEqual({
      left: true,
      group_deleted: true,
    });
    expect(ok(await bed.service.from('groups').select('id').eq('id', g2.id))).toEqual([]);
  });

  it('refuses non-members', async () => {
    const res = await loner.client.rpc('leave_group', { p_group_id: group.id });
    expect(res.error?.message).toMatch(/Not a member of this group/);
  });
});

describe('get_group_by_invite_code', () => {
  it('lets a non-member look up a group by its code, case- and space-insensitive', async () => {
    const rows = ok(
      await loner.client.rpc('get_group_by_invite_code', {
        code: `  ${group.invite_code.toLowerCase()} `,
      }),
    ) as Array<{ id: string; name: string }>;
    expect(rows).toEqual([{ id: group.id, name: group.name }]);
  });
});
