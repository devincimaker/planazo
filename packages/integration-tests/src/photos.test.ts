// PLA-56: `plan_album_card` answers the plan-detail card without the card
// fetching the album. The function runs with the caller's rights on purpose,
// and that is the thing worth testing against a real database: RLS deciding
// what is countable, per caller, including blocks.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestBed, TestUser, ok, daysFromNow } from './testbed';

const bed = new TestBed();
let host: TestUser;
/** Said yes, uploaded most of the album. */
let guest: TestUser;
/** In the group, never in the plan. May look, may not add. */
let bystander: TestUser;
/** Not in the group at all. */
let outsider: TestUser;
let planId: string;

const card = (as: TestUser) =>
  as.client.rpc('plan_album_card', { p_plan_id: planId }).single();

/** Rows only, no objects: the function reads paths, it never signs them. */
async function addPhoto(as: TestUser, key: string, opts: { thumb?: boolean; at: string }) {
  return ok(
    await as.client
      .from('plan_photos')
      .insert({
        plan_id: planId,
        uploaded_by: as.id,
        storage_path: `${planId}/${as.id}/${key}.jpg`,
        thumb_path: opts.thumb === false ? null : `${planId}/${as.id}/${key}_thumb.jpg`,
        created_at: opts.at,
      })
      .select('id')
      .single(),
  );
}

beforeAll(async () => {
  [host, guest, bystander, outsider] = await Promise.all([
    bed.createUser('Album Host'),
    bed.createUser('Album Guest'),
    bed.createUser('Album Bystander'),
    bed.createUser('Album Outsider'),
  ]);
  const group = await bed.createGroup(host);
  await Promise.all([bed.join(group.id, guest), bed.join(group.id, bystander)]);

  // Last night's plan: the album is open, and who may add is decided by the
  // rsvps exactly as production decides it.
  planId = ok(
    await host.client
      .from('plans')
      .insert({
        group_id: group.id,
        created_by: host.id,
        title: 'it-album-card',
        plan_type: 'fixed',
        event_date: daysFromNow(-1),
        min_people: 2,
        max_people: null,
      })
      .select('id')
      .single(),
  ).id;
  ok(await guest.client.from('rsvps').insert({ plan_id: planId, user_id: guest.id, response: 'yes' }));

  // Five photos, newest last: h1, h2, g1, g2, g3. g1 predates thumbnails.
  await addPhoto(host, 'h1', { at: '2026-08-03T20:00:00Z' });
  await addPhoto(host, 'h2', { at: '2026-08-03T20:10:00Z' });
  await addPhoto(guest, 'g1', { thumb: false, at: '2026-08-03T20:20:00Z' });
  await addPhoto(guest, 'g2', { at: '2026-08-03T20:30:00Z' });
  await addPhoto(guest, 'g3', { at: '2026-08-03T20:40:00Z' });
});

afterAll(() => bed.dispose());

describe('plan_album_card', () => {
  it('answers with counts and the newest four, each naming its uploader', async () => {
    const summary = ok(await card(guest));

    expect(summary.total).toBe(5);
    expect(summary.mine).toBe(3);
    expect(summary.uploaders).toBe(2);

    const recent = summary.recent as {
      storage_path: string;
      thumb_path: string | null;
      uploader_name: string | null;
    }[];
    expect(recent.map((r) => r.storage_path.split('/').pop())).toEqual([
      'g3.jpg',
      'g2.jpg',
      'g1.jpg',
      'h2.jpg',
    ]);
    // The sentence leads with the newest photo's uploader, read off recent[0].
    expect(recent.map((r) => r.uploader_name)).toEqual([
      'Album Guest',
      'Album Guest',
      'Album Guest',
      'Album Host',
    ]);
    // The rendition column rides along, NULL where the photo predates it.
    expect(recent[0].thumb_path?.endsWith('g3_thumb.jpg')).toBe(true);
    expect(recent[2].thumb_path).toBeNull();
  });

  it('counts "mine" by whoever is asking, not by an argument', async () => {
    expect(ok(await card(host)).mine).toBe(2);
    expect(ok(await card(bystander)).mine).toBe(0);
  });

  it('shows an outsider an empty album, not an error', async () => {
    const summary = ok(await card(outsider));

    expect(summary.total).toBe(0);
    expect(summary.uploaders).toBe(0);
    expect(summary.recent).toEqual([]);
  });

  // The SELECT policy hides an uploader's rows from anyone that uploader has
  // blocked (the shield rule, PLA-44), and invoker rights are what make that
  // reach the counts. SECURITY DEFINER here would quietly count photographs
  // the person asking can no longer see.
  it('drops the photos of whoever blocked you from every number', async () => {
    ok(
      await guest.client
        .from('blocked_users')
        .insert({ blocker_id: guest.id, blocked_id: bystander.id })
        .select()
        .single(),
    );

    // For the blocked bystander, the guest's three photos no longer exist.
    const summary = ok(await card(bystander));
    expect(summary.total).toBe(2);
    expect(summary.uploaders).toBe(1);
    const recent = summary.recent as { uploader_name: string | null }[];
    expect(recent.length).toBe(2);
    expect(recent[0].uploader_name).toBe('Album Host');

    // The guest, who did the blocking, keeps seeing the whole album.
    expect(ok(await card(guest)).total).toBe(5);
  });
});
