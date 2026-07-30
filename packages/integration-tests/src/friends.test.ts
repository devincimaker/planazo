// Friendships: by-consent model. send_friend_request auto-accepts a crossing
// request (them adding me back is consent from both sides), respond guards
// which side may flip status, and rows are visible to the two parties only.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { TestBed, TestUser, ok } from './testbed';

const bed = new TestBed();
let a: TestUser;
let b: TestUser;
let c: TestUser;
let d: TestUser;

beforeAll(async () => {
  [a, b, c, d] = await Promise.all([
    bed.createUser('Friend A'),
    bed.createUser('Friend B'),
    bed.createUser('Friend C'),
    bed.createUser('Friend D'),
  ]);
});

afterAll(() => bed.dispose());

describe('send_friend_request', () => {
  it('rejects self-requests and unknown people', async () => {
    const self = await a.client.rpc('send_friend_request', { p_addressee: a.id });
    expect(self.error?.message).toMatch(/Cannot befriend yourself/);

    const ghost = await a.client.rpc('send_friend_request', { p_addressee: randomUUID() });
    expect(ghost.error?.message).toMatch(/No such person/);
  });

  it('crossing requests auto-accept', async () => {
    expect(ok(await a.client.rpc('send_friend_request', { p_addressee: b.id }))).toEqual({
      status: 'requested',
    });
    expect(ok(await a.client.rpc('send_friend_request', { p_addressee: b.id }))).toEqual({
      status: 'already_requested',
    });

    // B adding A back while A's request is pending = consent from both sides.
    expect(ok(await b.client.rpc('send_friend_request', { p_addressee: a.id }))).toEqual({
      status: 'accepted',
    });
    expect(ok(await a.client.rpc('send_friend_request', { p_addressee: b.id }))).toEqual({
      status: 'already_friends',
    });

    // A third party sees nothing of the pair.
    expect(ok(await c.client.from('friendships').select('id'))).toEqual([]);
  });
});

describe('respond_friend_request', () => {
  it('only the addressee can respond; accepting stamps responded_at', async () => {
    ok(await c.client.rpc('send_friend_request', { p_addressee: d.id }));
    const row = ok(
      await c.client.from('friendships').select('id').eq('requester_id', c.id).single(),
    );

    const foreign = await a.client.rpc('respond_friend_request', {
      p_friendship_id: row.id,
      p_accept: true,
    });
    expect(foreign.error?.message).toMatch(/Request not found/);
    // The requester can't accept their own request either.
    const requester = await c.client.rpc('respond_friend_request', {
      p_friendship_id: row.id,
      p_accept: true,
    });
    expect(requester.error?.message).toMatch(/Request not found/);

    expect(
      ok(await d.client.rpc('respond_friend_request', { p_friendship_id: row.id, p_accept: true })),
    ).toEqual({ status: 'accepted' });

    const settled = ok(
      await d.client.from('friendships').select('status, responded_at').eq('id', row.id).single(),
    );
    expect(settled.status).toBe('accepted');
    expect(settled.responded_at).not.toBeNull();

    // Responding to an already-accepted friendship short-circuits.
    expect(
      ok(await d.client.rpc('respond_friend_request', { p_friendship_id: row.id, p_accept: false })),
    ).toEqual({ status: 'already_friends' });
  });

  it('an ignored request still auto-accepts when the ignorer adds them back', async () => {
    ok(await a.client.rpc('send_friend_request', { p_addressee: c.id }));
    const row = ok(
      await c.client
        .from('friendships')
        .select('id')
        .eq('requester_id', a.id)
        .eq('addressee_id', c.id)
        .single(),
    );
    expect(
      ok(await c.client.rpc('respond_friend_request', { p_friendship_id: row.id, p_accept: false })),
    ).toEqual({ status: 'ignored' });

    // C later adds A: A's request was already on the table, so it accepts.
    expect(ok(await c.client.rpc('send_friend_request', { p_addressee: a.id }))).toEqual({
      status: 'accepted',
    });
  });
});
