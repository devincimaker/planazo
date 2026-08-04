// PLA-44: the shield rule. A block erases you from the blocked person's life,
// not them from yours: they stop seeing what you create, cannot find or
// contact you, and no longer attend your plans, while you keep seeing them
// exactly as before. Never announced, never touching what belongs to the
// group; unblocking restores sight but never what it dissolved.
//
// Almost everything here is invisible from the client by construction — RLS
// making rows vanish, SECURITY DEFINER fan-outs, a trigger dissolving ties —
// so this file is where the rule actually gets checked, direction by
// direction. The old behaviour (a personal mute: has_blocked hiding *their*
// plans from *you*) is asserted dead in the "keeps seeing" tests.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { TestBed, TestUser, ok, daysFromNow } from './testbed';

const bed = new TestBed();

// A unique fragment in every display name, so search assertions can query for
// exactly this file's users no matter what else lives in the database.
const suffix = randomUUID().slice(0, 8);

let ana: TestUser; // the blocker
let beto: TestUser; // the blocked
let carla: TestUser; // a third party, blind to all of it
let g1: string;

let host2: TestUser;
let blocked2: TestUser;
let waiter2: TestUser;
let g2: string;

const block = (blocker: TestUser, blocked: TestUser) =>
  blocker.client
    .from('blocked_users')
    .upsert(
      { blocker_id: blocker.id, blocked_id: blocked.id },
      { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true },
    );

const unblock = (blocker: TestUser, blocked: TestUser) =>
  blocker.client
    .from('blocked_users')
    .delete()
    .eq('blocker_id', blocker.id)
    .eq('blocked_id', blocked.id);

async function createPlan(
  host: TestUser,
  groupId: string,
  opts: {
    planType?: 'fixed' | 'flexible';
    maxPeople?: number | null;
    eventDate?: string | null;
  } = {},
) {
  const planType = opts.planType ?? 'fixed';
  return ok(
    await host.client
      .from('plans')
      .insert({
        group_id: groupId,
        created_by: host.id,
        title: `shield-${randomUUID().slice(0, 8)}`,
        plan_type: planType,
        event_date:
          planType === 'fixed' ? (opts.eventDate ?? daysFromNow(7)) : null,
        min_people: 1,
        max_people: opts.maxPeople ?? null,
      })
      .select('id')
      .single(),
  ).id;
}

const say = (user: TestUser, planId: string, response: 'yes' | 'no' | 'pending') =>
  user.client
    .from('rsvps')
    .upsert({ plan_id: planId, user_id: user.id, response }, { onConflict: 'plan_id,user_id' });

const seesPlan = async (user: TestUser, planId: string) =>
  ok(await user.client.from('plans').select('id').eq('id', planId)).length === 1;

async function notified(userId: string, type: string, planId: string) {
  const rows = ok(
    await bed.service
      .from('notifications')
      .select('user_id')
      .eq('type', type)
      .eq('user_id', userId)
      .filter('data->>plan_id', 'eq', planId),
  );
  return rows.length > 0;
}

beforeAll(async () => {
  [ana, beto, carla, host2, blocked2, waiter2] = await Promise.all([
    bed.createUser(`Ana-${suffix}`),
    bed.createUser(`Beto-${suffix}`),
    bed.createUser(`Carla-${suffix}`),
    bed.createUser('Shield Host'),
    bed.createUser('Shield Blocked'),
    bed.createUser('Shield Waiter'),
  ]);
  [g1, g2] = await Promise.all([
    bed.createGroup(ana).then(async (g) => {
      await bed.join(g.id, beto);
      await bed.join(g.id, carla);
      return g.id;
    }),
    bed.createGroup(host2).then(async (g) => {
      await bed.join(g.id, blocked2);
      await bed.join(g.id, waiter2);
      return g.id;
    }),
  ]);
});

afterAll(() => bed.dispose());

// The tests in each describe run in order and share state on purpose: a block
// is a life-cycle (before → block → blocked world → block back → unblock),
// and the interesting claims are about the transitions.

describe('sight', () => {
  let anaPlan: string;
  let betoPlan: string;

  it('before any block, both see each other', async () => {
    anaPlan = await createPlan(ana, g1);
    betoPlan = await createPlan(beto, g1);
    expect(await seesPlan(beto, anaPlan)).toBe(true);
    expect(await seesPlan(ana, betoPlan)).toBe(true);
  });

  it("Ana blocks Beto: her plan stops existing for him, by list and by id", async () => {
    ok(await block(ana, beto));
    expect(await seesPlan(beto, anaPlan)).toBe(false);
    const feed = ok(await beto.client.from('plans').select('id').eq('group_id', g1));
    expect(feed.map((p) => p.id)).not.toContain(anaPlan);
  });

  it('Ana keeps seeing his plans exactly as before (the mute is dead)', async () => {
    expect(await seesPlan(ana, betoPlan)).toBe(true);
  });

  it('a third party sees everything', async () => {
    expect(await seesPlan(carla, anaPlan)).toBe(true);
    expect(await seesPlan(carla, betoPlan)).toBe(true);
  });

  it("he can no longer RSVP to a plan he cannot see", async () => {
    const res = await say(beto, anaPlan, 'yes');
    expect(res.error).not.toBeNull();
  });

  it("on a third party's plan they still see each other, and the count is real", async () => {
    const carlaPlan = await createPlan(carla, g1);
    ok(await say(ana, carlaPlan, 'yes'));
    ok(await say(beto, carlaPlan, 'yes'));
    const betoView = ok(
      await beto.client.from('rsvps').select('user_id').eq('plan_id', carlaPlan),
    ).map((r) => r.user_id);
    expect(betoView).toContain(ana.id);
    expect(betoView).toContain(beto.id);
  });
});

describe('notifications follow sight', () => {
  it('a new plan by Ana reaches Carla but not Beto', async () => {
    const planId = await createPlan(ana, g1);
    expect(await notified(carla.id, 'plan_created', planId)).toBe(true);
    expect(await notified(beto.id, 'plan_created', planId)).toBe(false);
  });

  it('a new plan by Beto still reaches Ana (the old direction is gone)', async () => {
    const planId = await createPlan(beto, g1);
    expect(await notified(ana.id, 'plan_created', planId)).toBe(true);
  });
});

describe('finding and contact', () => {
  it('search: Beto cannot find Ana; Ana still finds Beto', async () => {
    const betoSees = ok(await beto.client.rpc('search_people', { p_query: suffix })).map(
      (p) => p.id,
    );
    expect(betoSees).toContain(carla.id);
    expect(betoSees).not.toContain(ana.id);

    const anaSees = ok(await ana.client.rpc('search_people', { p_query: suffix })).map(
      (p) => p.id,
    );
    expect(anaSees).toContain(beto.id);
  });

  it('a friend request from Beto pretends to succeed and writes nothing', async () => {
    expect(ok(await beto.client.rpc('send_friend_request', { p_addressee: ana.id }))).toEqual({
      status: 'requested',
    });
    const rows = ok(
      await bed.service
        .from('friendships')
        .select('id')
        .eq('requester_id', beto.id)
        .eq('addressee_id', ana.id),
    );
    expect(rows).toEqual([]);
  });

  it('a friend request from Ana toward someone she blocked is answered honestly', async () => {
    expect(ok(await ana.client.rpc('send_friend_request', { p_addressee: beto.id }))).toEqual({
      status: 'you_blocked_them',
    });
  });

  it('group invites: same pair of answers, nothing written either way', async () => {
    const anaOnly = await bed.createGroup(ana);
    expect(
      ok(await ana.client.rpc('invite_to_group', { p_group_id: anaOnly.id, p_invitee: beto.id })),
    ).toEqual({ status: 'you_blocked_them' });

    const betoOnly = await bed.createGroup(beto);
    expect(
      ok(await beto.client.rpc('invite_to_group', { p_group_id: betoOnly.id, p_invitee: ana.id })),
    ).toEqual({ status: 'invited' });

    const rows = ok(
      await bed.service
        .from('group_invites')
        .select('id')
        .in('group_id', [anaOnly.id, betoOnly.id]),
    );
    expect(rows).toEqual([]);
  });
});

describe('blocking back, and unblocking one arrow at a time', () => {
  let anaPlan: string;
  let betoPlan: string;

  it('Beto blocks back from the member list he still sees: now neither sees the other', async () => {
    // The member row is where the Block button lives, and blocking never
    // touches membership — so the door is proven open by walking through it.
    const members = ok(
      await beto.client.from('group_members').select('user_id').eq('group_id', g1),
    ).map((m) => m.user_id);
    expect(members).toContain(ana.id);

    ok(await block(beto, ana));
    anaPlan = await createPlan(ana, g1);
    betoPlan = await createPlan(beto, g1);
    expect(await seesPlan(beto, anaPlan)).toBe(false);
    expect(await seesPlan(ana, betoPlan)).toBe(false);
  });

  it("Beto unblocks: Ana sees his plans again, his side of the shield stays up", async () => {
    ok(await unblock(beto, ana));
    expect(await seesPlan(ana, betoPlan)).toBe(true);
    expect(await seesPlan(beto, anaPlan)).toBe(false);
  });

  it('Ana unblocks: sight is fully restored', async () => {
    ok(await unblock(ana, beto));
    expect(await seesPlan(beto, anaPlan)).toBe(true);
  });
});

describe('what a block dissolves', () => {
  let pastPlan: string;
  let fullPlan: string;
  let flexPlan: string;

  it('setup: friends, an invite on the table, a past night, a full plan, a vote', async () => {
    // Friendship by the real path: request + crossing auto-accept.
    ok(await host2.client.rpc('send_friend_request', { p_addressee: blocked2.id }));
    expect(
      ok(await blocked2.client.rpc('send_friend_request', { p_addressee: host2.id })),
    ).toEqual({ status: 'accepted' });

    // A pending invite from host2 to a group blocked2 is not in.
    const side = await bed.createGroup(host2);
    expect(
      ok(
        await host2.client.rpc('invite_to_group', { p_group_id: side.id, p_invitee: blocked2.id }),
      ),
    ).toEqual({ status: 'invited' });

    // A plan already in the past, attended: history.
    pastPlan = await createPlan(host2, g2, { eventDate: daysFromNow(-3) });
    ok(await say(blocked2, pastPlan, 'yes'));

    // A capped future plan, full, with somebody waiting.
    fullPlan = await createPlan(host2, g2, { maxPeople: 2 });
    ok(await say(host2, fullPlan, 'yes'));
    ok(await say(blocked2, fullPlan, 'yes'));
    ok(await say(waiter2, fullPlan, 'pending'));

    // A flexible plan with blocked2's availability on the table.
    flexPlan = await createPlan(host2, g2, { planType: 'flexible' });
    const option = ok(
      await host2.client
        .from('plan_date_options')
        .insert({ plan_id: flexPlan, date: daysFromNow(10) })
        .select('id')
        .single(),
    );
    ok(
      await blocked2.client.from('date_availability').insert({
        plan_id: flexPlan,
        date_option_id: option.id,
        user_id: blocked2.id,
        available: true,
      }),
    );
  });

  it('the block dissolves the ties and the freed seat promotes the waiter', async () => {
    ok(await block(host2, blocked2));

    // Friendship: gone, both directions dead.
    expect(
      ok(
        await bed.service
          .from('friendships')
          .select('id')
          .or(
            `and(requester_id.eq.${host2.id},addressee_id.eq.${blocked2.id}),and(requester_id.eq.${blocked2.id},addressee_id.eq.${host2.id})`,
          ),
      ),
    ).toEqual([]);

    // Pending invite between the pair: gone.
    expect(
      ok(
        await bed.service
          .from('group_invites')
          .select('id')
          .eq('invited_by', host2.id)
          .eq('invitee_id', blocked2.id),
      ),
    ).toEqual([]);

    // His yes on the full plan: gone, and the seat went to the waiter through
    // the same promotion a real withdrawal uses, told about it and all.
    const rsvps = ok(
      await bed.service.from('rsvps').select('user_id, response').eq('plan_id', fullPlan),
    );
    expect(rsvps.find((r) => r.user_id === blocked2.id)).toBeUndefined();
    expect(rsvps.find((r) => r.user_id === waiter2.id)?.response).toBe('yes');
    expect(await notified(waiter2.id, 'plan_promoted', fullPlan)).toBe(true);

    // His availability on the open vote: gone.
    expect(
      ok(
        await bed.service
          .from('date_availability')
          .select('id')
          .eq('plan_id', flexPlan)
          .eq('user_id', blocked2.id),
      ),
    ).toEqual([]);

    // The past plan keeps its history.
    const past = ok(
      await bed.service
        .from('rsvps')
        .select('response')
        .eq('plan_id', pastPlan)
        .eq('user_id', blocked2.id)
        .single(),
    );
    expect(past.response).toBe('yes');

    // Membership is not the block's to touch.
    const members = ok(
      await bed.service.from('group_members').select('user_id').eq('group_id', g2),
    ).map((m) => m.user_id);
    expect(members).toContain(blocked2.id);
  });

  it('unblocking restores sight but nothing it dissolved', async () => {
    ok(await unblock(host2, blocked2));
    expect(await seesPlan(blocked2, fullPlan)).toBe(true);

    expect(
      ok(
        await bed.service
          .from('friendships')
          .select('id')
          .or(
            `and(requester_id.eq.${host2.id},addressee_id.eq.${blocked2.id}),and(requester_id.eq.${blocked2.id},addressee_id.eq.${host2.id})`,
          ),
      ),
    ).toEqual([]);
    const seat = ok(
      await bed.service
        .from('rsvps')
        .select('id')
        .eq('plan_id', fullPlan)
        .eq('user_id', blocked2.id),
    );
    expect(seat).toEqual([]);
  });
});
