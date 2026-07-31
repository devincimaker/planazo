// DB triggers: handle_new_user (profile + permanent handle at signup),
// trg_notify_plan_created (fan-out honoring notify_new_plans), and the
// trg_push_notification webhook, which must NEVER break a notification
// insert — locally Vault has no send_push_secret, so every insert in this
// suite already exercises the silent-skip path; the last test pins it down.
import { describe, it, expect, afterAll } from 'vitest';
import { TestBed, ok, daysFromNow } from './testbed';

const bed = new TestBed();

afterAll(() => bed.dispose());

describe('handle_new_user', () => {
  it('creates a profile with a slugged, deaccented handle', async () => {
    const rocio = await bed.createUser('Rocío Muñoz IT');
    const profile = ok(
      await rocio.client.from('profiles').select('display_name, handle').eq('id', rocio.id).single(),
    );
    expect(profile.display_name).toBe('Rocío Muñoz IT');
    // Earlier local runs may have claimed the clean slug; suffixes are the
    // documented collision behavior.
    expect(profile.handle).toMatch(/^rociomunozit\d*$/);
  });

  it('deduplicates colliding handles with a numeric suffix', async () => {
    const twin1 = await bed.createUser('Handle Twin IT');
    const twin2 = await bed.createUser('Handle Twin IT');
    const rows = ok(
      await twin1.client.from('profiles').select('id, handle').in('id', [twin1.id, twin2.id]),
    );
    const handles = rows.map((r) => r.handle);
    expect(handles[0]).not.toBe(handles[1]);
    for (const h of handles) expect(h).toMatch(/^handletwinit\d*$/);
  });

  it('falls back to the email prefix when no display name is given', async () => {
    const plain = await bed.createUser();
    const profile = ok(
      await plain.client.from('profiles').select('display_name').eq('id', plain.id).single(),
    );
    expect(profile.display_name).toBe(plain.email.split('@')[0]);
  });
});

describe('trg_notify_plan_created', () => {
  it('notifies members with notify_new_plans on, excluding the creator, with per-type copy', async () => {
    const creator = await bed.createUser('Trigger Creator');
    const onMember = await bed.createUser('Trigger On');
    const offMember = await bed.createUser('Trigger Off');
    const group = await bed.createGroup(creator);
    await bed.join(group.id, onMember);
    await bed.join(group.id, offMember);
    ok(await offMember.client.rpc('set_group_notify', { p_group_id: group.id, p_notify: false }));

    const fixedId = ok(
      await creator.client
        .from('plans')
        .insert({
          group_id: group.id,
          created_by: creator.id,
          title: 'Fixed fanout probe',
          plan_type: 'fixed',
          event_date: daysFromNow(7),
        })
        .select('id')
        .single(),
    ).id;
    const flexId = ok(
      await creator.client
        .from('plans')
        .insert({
          group_id: group.id,
          created_by: creator.id,
          title: 'Flexible fanout probe',
          plan_type: 'flexible',
        })
        .select('id')
        .single(),
    ).id;

    const onRows = ok(await onMember.client.from('notifications').select('*').eq('type', 'plan_created'));
    const forFixed = onRows.filter((n) => (n.data as { plan_id?: string })?.plan_id === fixedId);
    const forFlex = onRows.filter((n) => (n.data as { plan_id?: string })?.plan_id === flexId);
    expect(forFixed).toHaveLength(1);
    expect(forFixed[0].title).toBe('New plan');
    expect(forFixed[0].body).toBe('Trigger Creator put up "Fixed fanout probe" — are you in?');
    expect(forFlex).toHaveLength(1);
    expect(forFlex[0].body).toBe('Trigger Creator put up "Flexible fanout probe" — pick the dates that work.');

    expect(
      ok(await offMember.client.from('notifications').select('id').eq('type', 'plan_created')),
    ).toEqual([]);
    expect(
      ok(await creator.client.from('notifications').select('id').eq('type', 'plan_created')),
    ).toEqual([]);
  });
});

describe('trg_push_notification', () => {
  it('never breaks a notification insert when Vault has no send_push_secret', async () => {
    const user = await bed.createUser('Push Skip');
    const row = ok(
      await bed.service
        .from('notifications')
        .insert({
          user_id: user.id,
          type: 'plan_created',
          title: 'Push skip probe',
          body: 'inserted with an empty Vault',
        })
        .select('id, pushed_at')
        .single(),
    );
    expect(row.pushed_at).toBeNull();
  });
});
