// Seeds the local stack with the three states PLA-16 says must be escapable.
// Local only — refuses to run against anything that isn't loopback.
import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';

const env = {};
for (const line of execSync('supabase status -o env', { encoding: 'utf8' }).split('\n')) {
  const m = line.match(/^([A-Z_]+)="(.*)"$/);
  if (m) env[m[1]] = m[2];
}
const url = env.API_URL;
if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) {
  throw new Error(`Refusing to seed a non-local stack: ${url}`);
}
const db = createClient(url, env.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PASSWORD = 'Planazo123!';
const QA_EMAIL = 'qa@planazo.test';
const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString();

async function user(email, name) {
  const existing = (await db.auth.admin.listUsers()).data.users.find((u) => u.email === email);
  if (existing) await db.auth.admin.deleteUser(existing.id);
  const { data, error } = await db.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: name },
  });
  if (error) throw error;
  return data.user.id;
}

const die = ({ data, error }) => {
  if (error) throw new Error(error.message);
  return data;
};

const me = await user(QA_EMAIL, 'Rocío');
const marta = await user('marta@planazo.test', 'Marta');
const jordi = await user('jordi@planazo.test', 'Jordi');

const group = die(
  await db
    .from('groups')
    .insert({ name: 'Domingueros', invite_code: 'QAPLA16X', created_by: me })
    .select()
    .single(),
);
die(
  await db.from('group_members').insert([
    { group_id: group.id, user_id: me, role: 'admin' },
    { group_id: group.id, user_id: marta, role: 'member' },
    { group_id: group.id, user_id: jordi, role: 'member' },
  ]),
);

const plan = async (row) =>
  die(await db.from('plans').insert({ group_id: group.id, created_by: me, min_people: 2, ...row }).select().single());

// 1. Fixed plan, already answered yes — the plain dead "Change".
const fixedYes = await plan({
  title: 'Padel + pizza',
  plan_type: 'fixed',
  event_date: day(6),
  location: 'Padel Indoor Gràcia',
});
die(
  await db.from('rsvps').insert([
    { plan_id: fixedYes.id, user_id: me, response: 'yes' },
    { plan_id: fixedYes.id, user_id: marta, response: 'yes' },
  ]),
);

// 2. Fixed plan answered "no" by mistake — the "stuck on that plan permanently" case.
const fixedNo = await plan({ title: 'Sunday roast', plan_type: 'fixed', event_date: day(9) });
die(
  await db.from('rsvps').insert([
    { plan_id: fixedNo.id, user_id: me, response: 'no' },
    { plan_id: fixedNo.id, user_id: marta, response: 'yes' },
  ]),
);

// 3. Flexible plan, declined — the PLA-17 sibling.
const flexNo = await plan({ title: 'Escape room revenge', plan_type: 'flexible', event_date: null });
const flexOpts = die(
  await db
    .from('plan_date_options')
    .insert([{ plan_id: flexNo.id, date: day(11) }, { plan_id: flexNo.id, date: day(12) }])
    .select(),
);
die(await db.from('rsvps').insert({ plan_id: flexNo.id, user_id: me, response: 'no' }));
die(
  await db.from('date_availability').insert({
    plan_id: flexNo.id,
    user_id: marta,
    date_option_id: flexOpts[0].id,
    available: true,
  }),
);

// 4. The lock-in trap: a flexible plan locked onto a date everyone was free
// for. lock_plan turns that availability into a 'yes' nobody tapped — this is
// the row that could never be removed. Replicated here exactly as the RPC
// leaves it (the RPC itself needs an auth.uid(), which the service role lacks).
const locked = await plan({ title: 'Five-a-side at Powerleague', plan_type: 'flexible', event_date: null });
const lockedOpts = die(
  await db
    .from('plan_date_options')
    .insert([{ plan_id: locked.id, date: day(4) }, { plan_id: locked.id, date: day(5) }])
    .select(),
);
const lockedOn = lockedOpts[0];
die(
  await db.from('date_availability').insert([
    { plan_id: locked.id, user_id: me, date_option_id: lockedOn.id, available: true },
    { plan_id: locked.id, user_id: marta, date_option_id: lockedOn.id, available: true },
    { plan_id: locked.id, user_id: jordi, date_option_id: lockedOpts[1].id, available: true },
  ]),
);
die(
  await db
    .from('plans')
    .update({ status: 'locked', locked_date: lockedOn.date, locked_at: new Date().toISOString() })
    .eq('id', locked.id),
);
die(
  await db.from('rsvps').insert([
    { plan_id: locked.id, user_id: me, response: 'yes' },
    { plan_id: locked.id, user_id: marta, response: 'yes' },
  ]),
);

console.log(`
Seeded local stack — log in as:
  ${QA_EMAIL} / ${PASSWORD}

Group "Domingueros" (also: marta@planazo.test, jordi@planazo.test, same password)

  Padel + pizza .............. fixed, you said YES
  Sunday roast ............... fixed, you said NO   <- the "tapped it by mistake" trap
  Escape room revenge ........ flexible, you declined
  Five-a-side at Powerleague . LOCKED, you were seeded YES  <- the worst case
`);
