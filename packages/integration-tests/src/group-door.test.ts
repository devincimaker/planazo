// PLA-49: the group door. One rule, checked clause by clause.
//
//   Every entry into a group is vouched by a person, and everything a person
//   grants, a person can take back.
//
// Almost none of this is visible from a mocked client: a column REVOKE, four
// policies, and six SECURITY DEFINER functions that decide between them who
// gets in. The screens can only ever show what these answer, so this file is
// where the door is actually specified.
//
// The matrix join_group_by_invite_code answers, since it is the piece with the
// most cells and every one of them is below:
//
//                        | open              | approval
//   ---------------------+-------------------+---------------------------
//   member already       | already_member    | already_member
//   pending invitee      | joined            | joined (their invite is a vouch)
//   live requester       | joined            | requested, nothing filed
//   declined requester   | joined            | requested, nothing filed
//   anyone else          | joined            | requested, admins notified
//   removed member       | not_found, because the code they hold is dead
//
// Independent round trips go through Promise.all: against a branch database
// each one is real latency and the paired assertions do not care about order.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestBed, TestUser, ok } from './testbed';

const bed = new TestBed();

let founder: TestUser; // creates groups, and gets removed from one
let admin2: TestUser; // the second admin, who does the removing
let member1: TestUser; // a plain member
let stranger: TestUser; // knocks, and is let in
let outcast: TestUser; // knocks, and is silently declined

/**
 * A fresh group owned by `founder`, with `who_can_invite` / `join_mode` set.
 *
 * `members` are seated before the door is, and deliberately: bed.join goes in
 * by invite code, which under approval mode files a request instead — the very
 * behaviour most of these tests are about.
 */
async function doorGroup(
  name: string,
  door: {
    who_can_invite?: string;
    join_mode?: string;
    members?: Array<[TestUser, 'admin' | 'member']>;
  } = {},
) {
  const group = await bed.createGroup(founder, { name });
  for (const [user, role] of door.members ?? []) {
    await bed.join(group.id, user, role);
  }
  if (door.who_can_invite || door.join_mode) {
    ok(
      await founder.client.rpc('update_group_door', {
        p_group_id: group.id,
        p_who_can_invite: door.who_can_invite ?? undefined,
        p_join_mode: door.join_mode ?? undefined,
      }),
    );
  }
  return group;
}

/** The one group_invites row for this pair, read past RLS. */
async function inviteRow(groupId: string, userId: string) {
  const rows = ok(
    await bed.service
      .from('group_invites')
      .select('status, invited_by')
      .eq('group_id', groupId)
      .eq('invitee_id', userId),
  );
  return rows[0] ?? null;
}

const join = (user: TestUser, code: string) =>
  user.client.rpc('join_group_by_invite_code', { p_code: code });

beforeAll(async () => {
  [founder, admin2, member1, stranger, outcast] = await Promise.all([
    bed.createUser('Door Founder'),
    bed.createUser('Door Admin2'),
    bed.createUser('Door Member'),
    bed.createUser('Door Stranger'),
    bed.createUser('Door Outcast'),
  ]);
});

afterAll(() => bed.dispose());

// ---------------------------------------------------------------- Part 1

describe('the founder is not a standing credential', () => {
  // The finding this whole issue grew out of. The groups SELECT policy carried
  // a bare `created_by = auth.uid()` disjunct, so removing the founder took
  // their membership and left them the key: they read invite_code straight off
  // the row and walked back in.
  it('a removed founder sees no trace of the group, and the code they held is dead', async () => {
    const group = await doorGroup('Founder repro');
    await bed.join(group.id, admin2, 'admin');
    const heldCode = await bed.codeOf(group.id);

    ok(await admin2.client.rpc('remove_group_member', {
      p_group_id: group.id,
      p_user_id: founder.id,
    }));

    const [groups, members] = await Promise.all([
      founder.client.from('groups').select('id, name').eq('id', group.id),
      founder.client.from('group_members').select('id').eq('group_id', group.id),
    ]);
    expect(ok(groups)).toEqual([]);
    expect(ok(members)).toEqual([]);

    expect(ok(await join(founder, heldCode))).toEqual({ status: 'not_found' });
    expect(await inviteRow(group.id, founder.id)).toBeNull();
  });
});

describe('invite_code is off the table', () => {
  it('a member cannot select it, filter on it, or order by it', async () => {
    const group = await doorGroup('Column privilege probe');
    await bed.join(group.id, member1);
    const code = await bed.codeOf(group.id);

    const selected = await member1.client.from('groups').select('invite_code').eq('id', group.id);
    expect(selected.error?.code).toBe('42501');

    // The filter matters as much as the select: without the column privilege
    // this is an oracle you could walk one guess at a time, and no RLS policy
    // would ever notice.
    const filtered = await member1.client.from('groups').select('id').eq('invite_code', code);
    expect(filtered.error?.code).toBe('42501');

    const ordered = await member1.client
      .from('groups')
      .select('id')
      .eq('id', group.id)
      .order('invite_code');
    expect(ordered.error?.code).toBe('42501');

    // Everything else about the group still reads exactly as before.
    expect(
      ok(await member1.client.from('groups').select('id, name, join_mode').eq('id', group.id)),
    ).toEqual([{ id: group.id, name: 'Column privilege probe', join_mode: 'open' }]);
  });

  it('get_group_invite_code hands it back to members and to nobody else', async () => {
    const group = await doorGroup('Code RPC');
    await bed.join(group.id, member1);
    const code = await bed.codeOf(group.id);

    const [asAdmin, asMember] = await Promise.all([
      founder.client.rpc('get_group_invite_code', { p_group_id: group.id }),
      member1.client.rpc('get_group_invite_code', { p_group_id: group.id }),
    ]);
    expect(ok(asAdmin)).toBe(code);
    expect(ok(asMember)).toBe(code);

    const outsider = await stranger.client.rpc('get_group_invite_code', { p_group_id: group.id });
    expect(outsider.error?.message).toMatch(/Not a member of this group/);
  });

  it('a pending invitee reads the name but not the code, and a requester reads neither', async () => {
    const group = await doorGroup('Preview boundary', { join_mode: 'approval' });
    ok(
      await founder.client.rpc('invite_to_group', {
        p_group_id: group.id,
        p_invitee: member1.id,
      }),
    );
    const code = await bed.codeOf(group.id);
    // The knock, which deliberately does NOT extend the preview: the
    // pending-invitee policies test status = 'pending', and a request is not.
    expect(ok(await join(stranger, code))).toMatchObject({ status: 'requested' });

    const [inviteeGroups, inviteeMembers, inviteeCode] = await Promise.all([
      member1.client.from('groups').select('name').eq('id', group.id),
      member1.client.from('group_members').select('user_id').eq('group_id', group.id),
      member1.client.rpc('get_group_invite_code', { p_group_id: group.id }),
    ]);
    expect(ok(inviteeGroups)).toEqual([{ name: 'Preview boundary' }]);
    expect(ok(inviteeMembers)).toHaveLength(1);
    expect(inviteeCode.error?.message).toMatch(/Not a member of this group/);

    const [requesterGroups, requesterMembers, requesterCode] = await Promise.all([
      stranger.client.from('groups').select('name').eq('id', group.id),
      stranger.client.from('group_members').select('user_id').eq('group_id', group.id),
      stranger.client.rpc('get_group_invite_code', { p_group_id: group.id }),
    ]);
    expect(ok(requesterGroups)).toEqual([]);
    expect(ok(requesterMembers)).toEqual([]);
    expect(requesterCode.error?.message).toMatch(/Not a member of this group/);

    // What they do get is the name, through the preview RPC, and the fact that
    // this door has a doorman.
    expect(
      ok(await stranger.client.rpc('get_group_by_invite_code', { code })),
    ).toEqual([{ id: group.id, name: 'Preview boundary', join_mode: 'approval' }]);
  });
});

describe('rotate_invite_code', () => {
  it('kills the old link, mints a working one, and refuses a non-admin', async () => {
    const group = await doorGroup('Rotation');
    await bed.join(group.id, member1);
    const oldCode = await bed.codeOf(group.id);

    const denied = await member1.client.rpc('rotate_invite_code', { p_group_id: group.id });
    expect(denied.error?.message).toMatch(/Only admins can reset the invite link/);

    const newCode = ok(await founder.client.rpc('rotate_invite_code', { p_group_id: group.id }));
    expect(newCode).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    expect(newCode).not.toBe(oldCode);

    expect(ok(await join(stranger, oldCode))).toEqual({ status: 'not_found' });
    expect(ok(await join(stranger, newCode))).toMatchObject({
      status: 'joined',
      group_id: group.id,
    });
  });
});

describe('remove_group_member', () => {
  it('takes the membership, the invites they sent, and the code, in one go', async () => {
    const group = await doorGroup('Removal');
    await bed.join(group.id, member1);
    const oldCode = await bed.codeOf(group.id);

    // A vouch the departing member extended, which should not outlive them.
    ok(
      await member1.client.rpc('invite_to_group', {
        p_group_id: group.id,
        p_invitee: stranger.id,
      }),
    );
    expect(await inviteRow(group.id, stranger.id)).toMatchObject({ status: 'pending' });

    expect(
      ok(await founder.client.rpc('remove_group_member', {
        p_group_id: group.id,
        p_user_id: member1.id,
      })),
    ).toEqual({ status: 'removed' });

    expect(
      ok(await bed.service
        .from('group_members')
        .select('id')
        .eq('group_id', group.id)
        .eq('user_id', member1.id)),
    ).toEqual([]);
    expect(await inviteRow(group.id, stranger.id)).toBeNull();
    expect(await bed.codeOf(group.id)).not.toBe(oldCode);
    expect(ok(await join(member1, oldCode))).toEqual({ status: 'not_found' });
  });

  it('refuses a non-admin, and refuses an admin trying to remove themselves', async () => {
    const group = await doorGroup('Removal refusals');
    await bed.join(group.id, member1);

    const byMember = await member1.client.rpc('remove_group_member', {
      p_group_id: group.id,
      p_user_id: founder.id,
    });
    expect(byMember.error?.message).toMatch(/Only admins can remove members/);

    // Self-removal would skip heir promotion, empty-group deletion and the
    // no-rotation-on-leave rule. leave_group is the way out.
    const self = await founder.client.rpc('remove_group_member', {
      p_group_id: group.id,
      p_user_id: founder.id,
    });
    expect(self.error?.message).toMatch(/Use leave_group to leave a group/);

    expect(
      ok(await founder.client.rpc('remove_group_member', {
        p_group_id: group.id,
        p_user_id: stranger.id,
      })),
    ).toEqual({ status: 'not_a_member' });
  });

  it('a removed member can no longer withdraw the invites they sent', async () => {
    const group = await doorGroup('Withdraw after removal');
    await bed.join(group.id, member1);
    ok(
      await member1.client.rpc('invite_to_group', {
        p_group_id: group.id,
        p_invitee: outcast.id,
      }),
    );

    // Removal deletes their pending invites, so put one back past RLS to test
    // the policy rather than the function that made it moot.
    ok(await founder.client.rpc('remove_group_member', {
      p_group_id: group.id,
      p_user_id: member1.id,
    }));
    ok(
      await bed.service
        .from('group_invites')
        .insert({
          group_id: group.id,
          invited_by: member1.id,
          invitee_id: outcast.id,
          status: 'pending',
        }),
    );

    const attempt = ok(
      await member1.client.from('group_invites').delete().eq('group_id', group.id).select('id'),
    );
    expect(attempt).toEqual([]);
    expect(await inviteRow(group.id, outcast.id)).toMatchObject({ status: 'pending' });

    // An admin still can, which is the disjunct that stays untouched.
    expect(
      ok(await founder.client
        .from('group_invites')
        .delete()
        .eq('group_id', group.id)
        .eq('invitee_id', outcast.id)
        .select('id')),
    ).toHaveLength(1);
  });
});

describe('the raw DELETE on group_members is gone', () => {
  it('nobody deletes a membership row directly, not even their own', async () => {
    const group = await doorGroup('Delete policy');
    await bed.join(group.id, member1);

    // A policy-filtered DELETE is not an error, it is a 200 with nothing in
    // it — the PLA-16 shape. Both of these used to remove a row.
    const [own, kick] = await Promise.all([
      member1.client
        .from('group_members')
        .delete()
        .eq('group_id', group.id)
        .eq('user_id', member1.id)
        .select('id'),
      founder.client
        .from('group_members')
        .delete()
        .eq('group_id', group.id)
        .eq('user_id', member1.id)
        .select('id'),
    ]);
    expect(ok(own)).toEqual([]);
    expect(ok(kick)).toEqual([]);

    expect(
      ok(await bed.service.from('group_members').select('user_id').eq('group_id', group.id)),
    ).toHaveLength(2);
  });

  it('leave_group still promotes the heir and still deletes the empty group', async () => {
    const group = await doorGroup('Leave still works');
    await bed.join(group.id, member1);

    expect(
      ok(await founder.client.rpc('leave_group', { p_group_id: group.id })),
    ).toMatchObject({ left: true, promoted: member1.id });
    expect(
      ok(await bed.service
        .from('group_members')
        .select('role')
        .eq('group_id', group.id)
        .eq('user_id', member1.id)
        .single()).role,
    ).toBe('admin');

    expect(ok(await member1.client.rpc('leave_group', { p_group_id: group.id }))).toEqual({
      left: true,
      group_deleted: true,
    });
    expect(ok(await bed.service.from('groups').select('id').eq('id', group.id))).toEqual([]);
  });

  it('walking out voluntarily leaves the code alone', async () => {
    const group = await doorGroup('Leave keeps the code');
    await bed.join(group.id, member1);
    const code = await bed.codeOf(group.id);

    ok(await member1.client.rpc('leave_group', { p_group_id: group.id }));

    // Kicked and left are finally different things, and this is the whole
    // difference: someone who walked out was trusted with the code and stays
    // trusted. Pasting their old link back in is a rejoin among friends.
    expect(await bed.codeOf(group.id)).toBe(code);
    expect(ok(await join(member1, code))).toMatchObject({ status: 'joined' });
  });
});

// ---------------------------------------------------------------- Part 2

describe('create_group defaults', () => {
  it('opens fully, so a friend circle never meets the settings', async () => {
    const group = await bed.createGroup(founder, { name: 'Defaults' });
    const row = ok(
      await founder.client
        .from('groups')
        .select('who_can_invite, join_mode')
        .eq('id', group.id)
        .single(),
    );
    expect(row).toEqual({ who_can_invite: 'members', join_mode: 'open' });
  });
});

describe('approval mode', () => {
  it('files a request instead of a membership, and approving admits', async () => {
    const group = await doorGroup('Doorman', { join_mode: 'approval' });
    const code = await bed.codeOf(group.id);

    expect(ok(await join(stranger, code))).toEqual({
      status: 'requested',
      group_id: group.id,
      name: 'Doorman',
    });
    expect(await inviteRow(group.id, stranger.id)).toEqual({
      status: 'requested',
      invited_by: null,
    });
    expect(
      ok(await bed.service
        .from('group_members')
        .select('id')
        .eq('group_id', group.id)
        .eq('user_id', stranger.id)),
    ).toEqual([]);

    // The knock reaches the admins, and only the admins.
    const knocks = ok(
      await bed.service
        .from('notifications')
        .select('user_id, title, body')
        .eq('type', 'join_requested')
        .contains('data', { group_id: group.id }),
    );
    expect(knocks.map((n) => n.user_id)).toEqual([founder.id]);
    expect(knocks[0].body).toBe('Door Stranger asked to join Doorman.');

    expect(
      ok(await founder.client.rpc('respond_to_join_request', {
        p_group_id: group.id,
        p_user_id: stranger.id,
        p_approve: true,
      })),
    ).toEqual({ status: 'approved' });

    expect(
      ok(await bed.service
        .from('group_members')
        .select('role')
        .eq('group_id', group.id)
        .eq('user_id', stranger.id)
        .single()).role,
    ).toBe('member');
    // Approval is the admin's vouch, so the row records who gave it — which is
    // also what keeps the request-has-no-inviter CHECK satisfiable.
    expect(await inviteRow(group.id, stranger.id)).toEqual({
      status: 'accepted',
      invited_by: founder.id,
    });

    const told = ok(
      await bed.service
        .from('notifications')
        .select('user_id, body')
        .eq('type', 'join_approved')
        .contains('data', { group_id: group.id }),
    );
    expect(told).toEqual([
      { user_id: stranger.id, body: 'You have been let into Doorman.' },
    ]);
  });

  it('a decline is silent, final for that link, and files nothing new', async () => {
    const group = await doorGroup('Silent decline', { join_mode: 'approval' });
    const code = await bed.codeOf(group.id);

    ok(await join(outcast, code));
    ok(await founder.client.rpc('respond_to_join_request', {
      p_group_id: group.id,
      p_user_id: outcast.id,
      p_approve: false,
    }));
    expect(await inviteRow(group.id, outcast.id)).toEqual({
      status: 'request_declined',
      invited_by: null,
    });

    // Their screen keeps saying the request was sent, because the answer is
    // the same shape it was the first time.
    expect(ok(await join(outcast, code))).toMatchObject({ status: 'requested' });
    expect(await inviteRow(group.id, outcast.id)).toEqual({
      status: 'request_declined',
      invited_by: null,
    });

    // Nothing was sent, on the decline or on the re-knock. One knock, ever.
    const notes = ok(
      await bed.service
        .from('notifications')
        .select('id, type')
        .contains('data', { group_id: group.id }),
    );
    expect(notes.filter((n) => n.type === 'join_requested')).toHaveLength(1);
    expect(notes.filter((n) => n.type === 'join_approved')).toEqual([]);
  });

  it('refuses a non-admin on respond_to_join_request, and reports a settled one', async () => {
    const group = await doorGroup('Answering refusals', {
      join_mode: 'approval',
      members: [[member1, 'member']],
    });
    const code = await bed.codeOf(group.id);
    ok(await join(stranger, code));

    const denied = await member1.client.rpc('respond_to_join_request', {
      p_group_id: group.id,
      p_user_id: stranger.id,
      p_approve: true,
    });
    expect(denied.error?.message).toMatch(/Only admins can answer join requests/);

    ok(await founder.client.rpc('respond_to_join_request', {
      p_group_id: group.id,
      p_user_id: stranger.id,
      p_approve: true,
    }));
    // The second admin arriving at the same knock, or a request a member
    // turned into a real invite while the screen was open.
    expect(
      ok(await founder.client.rpc('respond_to_join_request', {
        p_group_id: group.id,
        p_user_id: stranger.id,
        p_approve: false,
      })),
    ).toEqual({ status: 'already_handled' });
  });

  it('a pending invitee walks straight in: a member already vouched', async () => {
    const group = await doorGroup('Invite beats the doorman', { join_mode: 'approval' });
    const code = await bed.codeOf(group.id);
    ok(
      await founder.client.rpc('invite_to_group', {
        p_group_id: group.id,
        p_invitee: stranger.id,
      }),
    );

    expect(ok(await join(stranger, code))).toMatchObject({
      status: 'joined',
      group_id: group.id,
    });
    // And the invite is spent, rather than going on offering them a group they
    // are standing in.
    expect(await inviteRow(group.id, stranger.id)).toMatchObject({ status: 'accepted' });
  });

  it("a member's invite supersedes a declined request", async () => {
    const group = await doorGroup('Escape hatch', {
      join_mode: 'approval',
      members: [[member1, 'member']],
    });
    const code = await bed.codeOf(group.id);

    ok(await join(outcast, code));
    ok(await founder.client.rpc('respond_to_join_request', {
      p_group_id: group.id,
      p_user_id: outcast.id,
      p_approve: false,
    }));

    // A person's vouch supersedes the group's silence — and it is a plain
    // member's vouch, which is the point.
    expect(
      ok(await member1.client.rpc('invite_to_group', {
        p_group_id: group.id,
        p_invitee: outcast.id,
      })),
    ).toEqual({ status: 'invited' });
    expect(await inviteRow(group.id, outcast.id)).toEqual({
      status: 'pending',
      invited_by: member1.id,
    });
    expect(ok(await join(outcast, code))).toMatchObject({ status: 'joined' });
  });

  it('turning approval off admits nobody', async () => {
    const group = await doorGroup('Mode flip', { join_mode: 'approval' });
    const code = await bed.codeOf(group.id);
    ok(await join(stranger, code));

    ok(await founder.client.rpc('update_group_door', {
      p_group_id: group.id,
      p_join_mode: 'open',
    }));

    // A mode is a rule about the door, not a decision about the people
    // standing at it. The request is exactly where it was.
    expect(await inviteRow(group.id, stranger.id)).toMatchObject({ status: 'requested' });
    expect(
      ok(await bed.service
        .from('group_members')
        .select('id')
        .eq('group_id', group.id)
        .eq('user_id', stranger.id)),
    ).toEqual([]);

    // What did change is the door: the same link now lets them in.
    expect(ok(await join(stranger, code))).toMatchObject({ status: 'joined' });
  });
});

describe('who_can_invite = admins', () => {
  it('shuts both credential forms to a plain member at once', async () => {
    const group = await doorGroup('Admins only', { who_can_invite: 'admins' });
    await bed.join(group.id, member1);

    const [named, link] = await Promise.all([
      member1.client.rpc('invite_to_group', { p_group_id: group.id, p_invitee: stranger.id }),
      member1.client.rpc('get_group_invite_code', { p_group_id: group.id }),
    ]);
    expect(named.error?.message).toMatch(/Only admins can invite to this group/);
    expect(link.error?.message).toMatch(/Only admins can invite to this group/);

    // Gating named invites while any member could still read the link would
    // gate nothing, which is why the one dial moves both.
    expect(
      ok(await founder.client.rpc('invite_to_group', {
        p_group_id: group.id,
        p_invitee: stranger.id,
      })),
    ).toEqual({ status: 'invited' });
    expect(ok(await founder.client.rpc('get_group_invite_code', { p_group_id: group.id }))).toBe(
      await bed.codeOf(group.id),
    );
  });
});

describe('update_group_door', () => {
  it('is admin-only, validates, and writes only what it is passed', async () => {
    const group = await doorGroup('Settings');
    await bed.join(group.id, member1);

    const denied = await member1.client.rpc('update_group_door', {
      p_group_id: group.id,
      p_join_mode: 'approval',
    });
    expect(denied.error?.message).toMatch(/Only admins can change these settings/);

    const nonsense = await founder.client.rpc('update_group_door', {
      p_group_id: group.id,
      p_join_mode: 'whenever',
    });
    expect(nonsense.error?.message).toMatch(/join_mode must be open or approval/);

    // One toggle at a time, so flipping one cannot carry a stale copy of the
    // other back over it.
    expect(
      ok(await founder.client.rpc('update_group_door', {
        p_group_id: group.id,
        p_who_can_invite: 'admins',
      })),
    ).toEqual({ who_can_invite: 'admins', join_mode: 'open' });
    expect(
      ok(await founder.client.rpc('update_group_door', {
        p_group_id: group.id,
        p_join_mode: 'approval',
      })),
    ).toEqual({ who_can_invite: 'admins', join_mode: 'approval' });
  });
});

describe('where the door meets the shield rule', () => {
  it('hides a knock from an admin the requester blocked, and shows it to one who blocked them', async () => {
    const group = await doorGroup('Shielded knocks', { join_mode: 'approval' });
    await bed.join(group.id, admin2, 'admin');
    const code = await bed.codeOf(group.id);

    // The requester blocks one admin; the other admin blocks the requester.
    // One arrow each, pointing opposite ways.
    await Promise.all([
      ok(
        await outcast.client
          .from('blocked_users')
          .insert({ blocker_id: outcast.id, blocked_id: founder.id }),
      ),
      ok(
        await admin2.client
          .from('blocked_users')
          .insert({ blocker_id: admin2.id, blocked_id: outcast.id }),
      ),
    ]);

    ok(await join(outcast, code));

    // The blocked stop seeing what the blocker creates, and a knock is
    // something they created.
    const [hidden, shown] = await Promise.all([
      founder.client.from('group_invites').select('invitee_id').eq('group_id', group.id),
      admin2.client.from('group_invites').select('invitee_id').eq('group_id', group.id),
    ]);
    expect(ok(hidden)).toEqual([]);
    // A blocker keeps seeing the blocked exactly as before, and can answer.
    expect(ok(shown)).toEqual([{ invitee_id: outcast.id }]);

    // The push follows sight, same direction.
    const knocks = ok(
      await bed.service
        .from('notifications')
        .select('user_id')
        .eq('type', 'join_requested')
        .contains('data', { group_id: group.id }),
    );
    expect(knocks.map((n) => n.user_id)).toEqual([admin2.id]);

    // Blocks never police what belongs to the group: the admin who blocked
    // them can still let them in.
    expect(
      ok(await admin2.client.rpc('respond_to_join_request', {
        p_group_id: group.id,
        p_user_id: outcast.id,
        p_approve: true,
      })),
    ).toEqual({ status: 'approved' });

    await Promise.all([
      outcast.client
        .from('blocked_users')
        .delete()
        .eq('blocker_id', outcast.id)
        .eq('blocked_id', founder.id),
      admin2.client
        .from('blocked_users')
        .delete()
        .eq('blocker_id', admin2.id)
        .eq('blocked_id', outcast.id),
    ]);
  });

  it('keeps requests off every ordinary member’s view', async () => {
    const group = await doorGroup('Requests are an admin thing', {
      join_mode: 'approval',
      members: [[member1, 'member']],
    });
    const code = await bed.codeOf(group.id);
    ok(await join(stranger, code));

    expect(
      ok(await member1.client.from('group_invites').select('invitee_id').eq('group_id', group.id)),
    ).toEqual([]);
    // The requester can always read their own row. It is the one thing they
    // are told about their own knock.
    expect(
      ok(await stranger.client.from('group_invites').select('status').eq('group_id', group.id)),
    ).toEqual([{ status: 'requested' }]);
  });
});
