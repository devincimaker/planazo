// Puts this checkout's database into the one state the waiting list needs to
// be seen (PLA-37): a plan whose places are all taken, with somebody already
// queued, so the demo account meets a full plan and lands second in line.
//
// Runs on top of `pnpm db:seed:demo`, whose accounts and groups it reuses.
// Idempotent: it deletes and rebuilds its own plan every time, so you can go
// round the walkthrough as often as you like.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../.env') });

const PLAN_TITLE = 'Padel, two courts';
const GROUP_NAME = 'Weekend Crew';

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const svc = createClient(
  requiredEnv('SUPABASE_URL').replace(/\/+$/, ''),
  requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function ok(res) {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

const { data: userPage, error: userError } = await svc.auth.admin.listUsers({ perPage: 200 });
if (userError) throw new Error(userError.message);
const idFor = (email) => {
  const user = userPage.users.find((u) => u.email === email);
  if (!user) throw new Error(`No ${email}. Run \`pnpm db:seed:demo\` first.`);
  return user.id;
};

const demo = idFor('demo.planazo@example.com');
const alex = idFor('alex.rivera@example.com');
const bianca = idFor('bianca.stone@example.com');
const lucia = idFor('lucia.chen@example.com');

const groups = ok(await svc.from('groups').select('id').eq('name', GROUP_NAME));
if (!groups.length) throw new Error(`No "${GROUP_NAME}" group. Run \`pnpm db:seed:demo\` first.`);
const groupId = groups[0].id;

for (const userId of [demo, alex, bianca, lucia]) {
  ok(
    await svc
      .from('group_members')
      .upsert(
        { group_id: groupId, user_id: userId, role: userId === demo ? 'admin' : 'member' },
        { onConflict: 'group_id,user_id' },
      ),
  );
}

// Rebuild from scratch, so a second run undoes whatever the first walkthrough did.
ok(await svc.from('plans').delete().eq('title', PLAN_TITLE));

const plan = ok(
  await svc
    .from('plans')
    .insert({
      group_id: groupId,
      created_by: alex,
      title: PLAN_TITLE,
      plan_type: 'fixed',
      location: 'Padel Indoor Gracia',
      event_date: new Date(Date.now() + 5 * 86_400_000).toISOString(),
      min_people: 2,
      max_people: 2,
      status: 'open',
    })
    .select('id')
    .single(),
);

// Both places gone. The cap trigger would refuse a third yes, which is the
// point: the demo account meets a full plan.
ok(
  await svc.from('rsvps').insert([
    { plan_id: plan.id, user_id: alex, response: 'yes' },
    { plan_id: plan.id, user_id: bianca, response: 'yes' },
  ]),
);

// One person already waiting, so the demo account joins *second* and the
// position is a real number rather than always "next".
ok(await svc.from('rsvps').insert({ plan_id: plan.id, user_id: lucia, response: 'pending' }));

// A stale promotion notice would make the new one ambiguous.
ok(await svc.from('notifications').delete().eq('type', 'plan_promoted'));

console.log(`Seeded "${PLAN_TITLE}" in ${GROUP_NAME}.`);
console.log('  In:      Alex Rivera, Bianca Stone (2 of 2, so it is full)');
console.log('  Waiting: Lucia Chen');
console.log('');
console.log('Sign in as demo.planazo@example.com / Planazo123! and take the next spot.');
console.log('To free a place, sign in as alex.rivera@example.com and tap Change.');
