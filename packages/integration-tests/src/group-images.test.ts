// PLA-30 group photos. The whole point of the feature is a bucket that only
// group admins can write to, and no mocked test can tell you whether the
// storage policies in 20260803000001_group_images.sql actually say that.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestBed, TestUser, ok } from './testbed';

const BUCKET = 'group-images';

const bed = new TestBed();
let owner: TestUser;
let member: TestUser;
/** Admin of their own group, and a stranger to this one. */
let otherAdmin: TestUser;
let group: { id: string };
let otherGroup: { id: string };

/** A one-pixel JPEG is still a JPEG, and this suite is about who may write. */
const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0xff, 0xd9,
]);

function objectPath(groupId: string) {
  return `${groupId}/cover.jpg`;
}

beforeAll(async () => {
  [owner, member, otherAdmin] = await Promise.all([
    bed.createUser('Photo Owner'),
    bed.createUser('Photo Member'),
    bed.createUser('Photo Other Admin'),
  ]);
  group = await bed.createGroup(owner);
  otherGroup = await bed.createGroup(otherAdmin);
  await bed.join(group.id, member);
});

afterAll(async () => {
  // Objects are not rows, so dispose() does not know about them.
  await bed.service.storage
    .from(BUCKET)
    .remove([objectPath(group.id), objectPath(otherGroup.id)]);
  await bed.dispose();
});

describe('group photo storage', () => {
  it('lets an admin upload into their own group folder', async () => {
    const { error } = await owner.client.storage
      .from(BUCKET)
      .upload(objectPath(group.id), JPEG, { upsert: true, contentType: 'image/jpeg' });

    expect(error).toBeNull();
  });

  it('lets the admin replace it, which is what upsert does', async () => {
    const { error } = await owner.client.storage
      .from(BUCKET)
      .upload(objectPath(group.id), JPEG, { upsert: true, contentType: 'image/jpeg' });

    expect(error).toBeNull();
  });

  it('refuses an ordinary member of the same group', async () => {
    const { error } = await member.client.storage
      .from(BUCKET)
      .upload(objectPath(group.id), JPEG, { upsert: true, contentType: 'image/jpeg' });

    expect(error).not.toBeNull();
  });

  // Being an admin somewhere is not being an admin here.
  it('refuses an admin of a different group', async () => {
    const { error } = await otherAdmin.client.storage
      .from(BUCKET)
      .upload(objectPath(group.id), JPEG, { upsert: true, contentType: 'image/jpeg' });

    expect(error).not.toBeNull();
  });

  it('still lets that admin write their own group folder', async () => {
    const { error } = await otherAdmin.client.storage
      .from(BUCKET)
      .upload(objectPath(otherGroup.id), JPEG, { upsert: true, contentType: 'image/jpeg' });

    expect(error).toBeNull();
  });

  // The policy casts the folder name to a UUID. Unguarded that raises 22P02
  // rather than simply failing the check, which would be a 500 not a 403.
  it('refuses a folder name that is not a group id, without erroring on the cast', async () => {
    const { error } = await owner.client.storage
      .from(BUCKET)
      .upload('not-a-uuid/cover.jpg', JPEG, { upsert: true, contentType: 'image/jpeg' });

    expect(error).not.toBeNull();
    expect(JSON.stringify(error)).not.toContain('22P02');
  });

  // remove() does not throw on a policy refusal; it just reports nothing
  // deleted. So the object still being there is the assertion that matters.
  it('refuses a member deleting the photo', async () => {
    const { data } = await member.client.storage.from(BUCKET).remove([objectPath(group.id)]);
    expect(data ?? []).toHaveLength(0);

    const { data: listed } = await bed.service.storage
      .from(BUCKET)
      .list(group.id, { search: 'cover.jpg' });
    expect(listed).toHaveLength(1);
  });

  it('lets an admin delete the photo', async () => {
    const { data, error } = await owner.client.storage
      .from(BUCKET)
      .remove([objectPath(group.id)]);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);

    const { data: listed } = await bed.service.storage
      .from(BUCKET)
      .list(group.id, { search: 'cover.jpg' });
    expect(listed).toHaveLength(0);
  });
});

describe('groups.image_url', () => {
  it('is writable by an admin and readable by the group', async () => {
    const url = 'https://cdn.example/group-images/cover.jpg?t=1';
    ok(await owner.client.from('groups').update({ image_url: url }).eq('id', group.id));

    const seen = ok(
      await member.client.from('groups').select('image_url').eq('id', group.id).single(),
    );
    expect(seen.image_url).toBe(url);
  });

  it('is not writable by an ordinary member', async () => {
    const before = ok(
      await bed.service.from('groups').select('image_url').eq('id', group.id).single(),
    ).image_url;

    await member.client
      .from('groups')
      .update({ image_url: 'https://cdn.example/hijack.jpg' })
      .eq('id', group.id);

    const after = ok(
      await bed.service.from('groups').select('image_url').eq('id', group.id).single(),
    ).image_url;
    expect(after).toBe(before);
  });

  it('defaults to null, so the letter tile stays the default', async () => {
    const fresh = await bed.createGroup(owner, { name: 'it-no-photo' });
    const row = ok(
      await owner.client.from('groups').select('image_url').eq('id', fresh.id).single(),
    );

    expect(row.image_url).toBeNull();
  });
});
