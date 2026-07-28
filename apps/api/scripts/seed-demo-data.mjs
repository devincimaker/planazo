import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../.env') });

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD || 'Planazo123!';

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

const supabaseUrl = requiredEnv('SUPABASE_URL').replace(/\/+$/, '');
const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const demoUsers = [
  { handle: 'demo', email: 'demo.planazo@example.com', displayName: 'Demo Explorer' },
  { handle: 'alex', email: 'alex.rivera@example.com', displayName: 'Alex Rivera' },
  { handle: 'bianca', email: 'bianca.stone@example.com', displayName: 'Bianca Stone' },
  { handle: 'diego', email: 'diego.morales@example.com', displayName: 'Diego Morales' },
  { handle: 'lucia', email: 'lucia.chen@example.com', displayName: 'Lucia Chen' },
  { handle: 'maya', email: 'maya.patel@example.com', displayName: 'Maya Patel' },
  { handle: 'theo', email: 'theo.brooks@example.com', displayName: 'Theo Brooks' },
  { handle: 'nina', email: 'nina.park@example.com', displayName: 'Nina Park' },
  { handle: 'sam', email: 'sam.green@example.com', displayName: 'Sam Green' },
];

const demoGroups = [
  {
    key: 'weekend',
    inviteCode: 'WEEKEND',
    name: 'Weekend Crew',
    description: 'Low-pressure plans for Saturdays, Sundays, and last-minute ideas.',
    members: ['primary', 'demo', 'alex', 'bianca', 'diego', 'maya', 'sam'],
  },
  {
    key: 'food',
    inviteCode: 'FOODIE',
    name: 'Food & Drinks',
    description: 'Restaurants, bars, pop-ups, and dinner experiments.',
    members: ['primary', 'demo', 'alex', 'bianca', 'lucia', 'theo', 'nina'],
  },
  {
    key: 'outdoors',
    inviteCode: 'OUTSIDE',
    name: 'Outdoors Club',
    description: 'Hikes, parks, paddle days, and anything outside.',
    members: ['primary', 'demo', 'diego', 'lucia', 'maya', 'nina', 'sam'],
  },
  {
    key: 'culture',
    inviteCode: 'CULTURE',
    name: 'Culture Club',
    description: 'Museums, concerts, galleries, and coffee after.',
    members: ['primary', 'demo', 'bianca', 'lucia', 'maya', 'theo'],
  },
];

function futureDate(daysFromNow, hour = 19, minute = 0) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function makePlanDefinitions() {
  return [
    {
      key: 'trail-hike',
      groupKey: 'outdoors',
      title: 'Sunrise hike at Cerro Arco',
      description: 'Easy pace, snacks at the top, and coffee afterwards.',
      location: 'Cerro Arco trailhead',
      plan_type: 'fixed',
      event_date: futureDate(6, 8),
      min_people: 3,
      max_people: 8,
      status: 'open',
      rsvps: {
        yes: ['primary', 'demo', 'diego', 'lucia', 'nina'],
        no: ['sam'],
      },
    },
    {
      key: 'pizza-night',
      groupKey: 'food',
      title: 'Rooftop pizza night',
      description: 'Trying the new sourdough pizza place and splitting a few pies.',
      location: 'Terraza Centro',
      plan_type: 'fixed',
      event_date: futureDate(8, 20, 30),
      min_people: 4,
      max_people: 10,
      status: 'open',
      rsvps: {
        yes: ['primary', 'demo', 'alex', 'bianca', 'theo'],
        no: ['lucia'],
      },
    },
    {
      key: 'ramen-popup',
      groupKey: 'food',
      title: 'New ramen pop-up',
      description: 'Small spot, limited seats, probably worth booking early.',
      location: 'Noodle Lab',
      plan_type: 'fixed',
      event_date: futureDate(10, 19, 30),
      min_people: 3,
      max_people: 6,
      status: 'open',
      rsvps: {
        yes: ['alex', 'diego'],
        no: [],
      },
    },
    {
      key: 'arcade',
      groupKey: 'weekend',
      title: 'Arcade tournament',
      description: 'Pinball, racing games, and a low-stakes leaderboard.',
      location: 'Pixel Bar',
      plan_type: 'fixed',
      event_date: futureDate(14, 18),
      min_people: 4,
      max_people: null,
      status: 'open',
      rsvps: {
        yes: ['alex', 'bianca', 'diego', 'maya'],
        no: [],
      },
    },
    {
      key: 'old-concert',
      groupKey: 'culture',
      title: 'Outdoor concert idea',
      description: 'Cancelled because the venue moved the date.',
      location: 'Parque Central',
      plan_type: 'fixed',
      event_date: futureDate(12, 21),
      min_people: 3,
      max_people: null,
      status: 'cancelled',
      rsvps: {
        yes: ['primary', 'demo', 'bianca', 'theo'],
        no: [],
      },
    },
    {
      key: 'board-games',
      groupKey: 'weekend',
      title: 'Board games and snacks',
      description: 'Pick the night that works for the most people.',
      location: 'Maya apartment',
      plan_type: 'flexible',
      dateOptions: [futureDate(3, 20), futureDate(4, 20), futureDate(5, 20)],
      min_people: 3,
      max_people: 8,
      status: 'open',
      availability: {
        primary: [0, 1],
        demo: [0, 1, 2],
        alex: [0, 2],
        bianca: [0, 1],
        maya: [1, 2],
        sam: [2],
      },
    },
    {
      key: 'kayaking',
      groupKey: 'outdoors',
      title: 'Pick a day for kayaking',
      description: 'Checking weather and choosing the best slot.',
      location: 'Potrerillos',
      plan_type: 'flexible',
      dateOptions: [futureDate(12, 10), futureDate(13, 10), futureDate(19, 10)],
      min_people: 4,
      max_people: 7,
      status: 'open',
      availability: {
        diego: [0, 1],
        demo: [1, 2],
        lucia: [1, 2],
        maya: [0, 2],
        nina: [1],
        sam: [2],
      },
    },
    {
      key: 'gallery',
      groupKey: 'culture',
      title: 'Gallery night and coffee',
      description: 'Short gallery visit, then coffee or vermouth nearby.',
      location: 'Museo Municipal',
      plan_type: 'flexible',
      dateOptions: [futureDate(7, 18), futureDate(9, 18), futureDate(11, 18)],
      min_people: 2,
      max_people: 6,
      status: 'open',
      availability: {
        bianca: [0, 1],
        lucia: [1],
        theo: [0, 2],
      },
      declined: ['primary', 'demo'],
    },
    {
      key: 'pasta',
      groupKey: 'food',
      title: 'Homemade pasta workshop',
      description: 'Make pasta from scratch and vote on the best sauce.',
      location: 'Nina kitchen',
      plan_type: 'flexible',
      dateOptions: [futureDate(16, 19), futureDate(17, 19), futureDate(18, 19)],
      min_people: 3,
      max_people: 6,
      status: 'open',
      availability: {
        primary: [0, 2],
        demo: [0, 1],
        alex: [0],
        lucia: [0, 1],
        nina: [0, 1, 2],
        theo: [2],
      },
    },
  ];
}

async function assertSchemaExists() {
  const { error } = await supabase.from('profiles').select('id').limit(1);
  if (!error) return;

  if (error.code === 'PGRST205' || error.message?.includes("Could not find the table 'public.profiles'")) {
    throw new Error(
      'The public.profiles table does not exist. Apply the Supabase migrations before running this seed script.'
    );
  }

  throw error;
}

async function listAuthUsers() {
  const users = [];
  let page = 1;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 1000,
    });

    if (error) throw error;
    users.push(...(data.users || []));

    if (!data.users || data.users.length < 1000) break;
    page += 1;
  }

  return users;
}

function displayNameForAuthUser(user) {
  if (user.user_metadata?.display_name) return user.user_metadata.display_name;
  if (user.user_metadata?.name) return user.user_metadata.name;
  return user.email.split('@')[0].replace(/[._+-]+/g, ' ');
}

async function ensureDemoUsers(existingUsers) {
  const usersByEmail = new Map(
    existingUsers
      .filter((user) => user.email)
      .map((user) => [user.email.toLowerCase(), user])
  );

  const ensured = [];

  for (const person of demoUsers) {
    const existing = usersByEmail.get(person.email.toLowerCase());

    if (existing) {
      const { data, error } = await supabase.auth.admin.updateUserById(existing.id, {
        password: DEMO_PASSWORD,
        user_metadata: { display_name: person.displayName, seed: 'demo' },
      });
      if (error) throw error;
      ensured.push({ ...person, id: data.user.id });
      continue;
    }

    const { data, error } = await supabase.auth.admin.createUser({
      email: person.email,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: person.displayName, seed: 'demo' },
    });

    if (error) throw error;
    ensured.push({ ...person, id: data.user.id });
  }

  return ensured;
}

function uniqueById(users) {
  const seen = new Set();
  return users.filter((user) => {
    if (!user?.id || seen.has(user.id)) return false;
    seen.add(user.id);
    return true;
  });
}

async function upsertProfiles(people) {
  const rows = people.map((person) => ({
    id: person.id,
    email: person.email,
    display_name: person.displayName,
    avatar_url: null,
    push_token: null,
  }));

  const { error } = await supabase.from('profiles').upsert(rows, { onConflict: 'id' });
  if (error) throw error;
}

async function upsertGroups(primaryUserId) {
  const groupRows = demoGroups.map((group) => ({
    name: group.name,
    description: group.description,
    invite_code: group.inviteCode,
    created_by: primaryUserId,
  }));

  const { data, error } = await supabase
    .from('groups')
    .upsert(groupRows, { onConflict: 'invite_code' })
    .select();

  if (error) throw error;

  return new Map(data.map((group) => {
    const definition = demoGroups.find((item) => item.inviteCode === group.invite_code);
    return [definition.key, group];
  }));
}

function resolveHandle(handle, primary, peopleByHandle) {
  if (handle === 'primary') return primary;
  return peopleByHandle.get(handle);
}

async function upsertMemberships(groupsByKey, primary, peopleByHandle) {
  const rows = [];

  for (const group of demoGroups) {
    const savedGroup = groupsByKey.get(group.key);
    const members = uniqueById(
      group.members
        .map((handle) => resolveHandle(handle, primary, peopleByHandle))
        .filter(Boolean)
    );

    for (const member of members) {
      rows.push({
        group_id: savedGroup.id,
        user_id: member.id,
        role: member.id === primary.id || member.handle === 'demo' ? 'admin' : 'member',
      });
    }
  }

  const { error } = await supabase
    .from('group_members')
    .upsert(rows, { onConflict: 'group_id,user_id' });

  if (error) throw error;
}

async function deleteExistingDemoPlans(groupsByKey) {
  const groupIds = Array.from(groupsByKey.values()).map((group) => group.id);

  await supabase.from('notifications').delete().contains('data', { seed: 'demo' });

  const { error } = await supabase.from('plans').delete().in('group_id', groupIds);
  if (error) throw error;
}

async function insertPlans(planDefinitions, groupsByKey, primary) {
  const planRows = planDefinitions.map((plan) => ({
    group_id: groupsByKey.get(plan.groupKey).id,
    created_by: primary.id,
    title: plan.title,
    description: plan.description,
    location: plan.location,
    plan_type: plan.plan_type,
    event_date: plan.plan_type === 'fixed' ? plan.event_date : null,
    min_people: plan.min_people,
    max_people: plan.max_people,
    status: plan.status,
    locked_date: null,
    locked_at: null,
    deadline: null,
  }));

  const { data, error } = await supabase.from('plans').insert(planRows).select();
  if (error) throw error;

  return new Map(data.map((plan) => {
    const definition = planDefinitions.find((item) => item.title === plan.title);
    return [definition.key, plan];
  }));
}

async function insertFixedPlanRsvps(planDefinitions, plansByKey, primary, peopleByHandle) {
  const rows = [];

  for (const definition of planDefinitions.filter((plan) => plan.plan_type === 'fixed')) {
    const plan = plansByKey.get(definition.key);
    const responses = [
      ...(definition.rsvps.yes || []).map((handle) => ({ handle, response: 'yes' })),
      ...(definition.rsvps.no || []).map((handle) => ({ handle, response: 'no' })),
    ];

    const seen = new Set();
    for (const item of responses) {
      const person = resolveHandle(item.handle, primary, peopleByHandle);
      if (!person || seen.has(person.id)) continue;
      seen.add(person.id);

      rows.push({
        plan_id: plan.id,
        user_id: person.id,
        response: item.response,
      });
    }
  }

  if (rows.length === 0) return;

  const { error } = await supabase.from('rsvps').insert(rows);
  if (error) throw error;
}

async function insertFlexiblePlanData(planDefinitions, plansByKey, primary, peopleByHandle) {
  const flexiblePlans = planDefinitions.filter((plan) => plan.plan_type === 'flexible');
  const optionRows = [];

  for (const definition of flexiblePlans) {
    const plan = plansByKey.get(definition.key);
    for (const date of definition.dateOptions) {
      optionRows.push({ plan_id: plan.id, date });
    }
  }

  const { data: options, error: optionError } = await supabase
    .from('plan_date_options')
    .insert(optionRows)
    .select();

  if (optionError) throw optionError;

  const optionsByPlanAndIndex = new Map();
  for (const definition of flexiblePlans) {
    const plan = plansByKey.get(definition.key);
    const planOptions = options
      .filter((option) => option.plan_id === plan.id)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    optionsByPlanAndIndex.set(definition.key, planOptions);
  }

  const availabilityRows = [];
  const declinedRows = [];

  for (const definition of flexiblePlans) {
    const plan = plansByKey.get(definition.key);
    const planOptions = optionsByPlanAndIndex.get(definition.key);

    for (const [handle, dateIndexes] of Object.entries(definition.availability || {})) {
      const person = resolveHandle(handle, primary, peopleByHandle);
      if (!person) continue;

      for (const dateIndex of dateIndexes) {
        const option = planOptions[dateIndex];
        if (!option) continue;

        availabilityRows.push({
          plan_id: plan.id,
          user_id: person.id,
          date_option_id: option.id,
          available: true,
        });
      }
    }

    for (const handle of definition.declined || []) {
      const person = resolveHandle(handle, primary, peopleByHandle);
      if (!person) continue;

      declinedRows.push({
        plan_id: plan.id,
        user_id: person.id,
        response: 'no',
      });
    }
  }

  if (availabilityRows.length > 0) {
    const { error } = await supabase.from('date_availability').insert(availabilityRows);
    if (error) throw error;
  }

  if (declinedRows.length > 0) {
    const { error } = await supabase.from('rsvps').insert(declinedRows);
    if (error) throw error;
  }
}

async function insertNotifications(primary, plansByKey) {
  const rows = [
    {
      user_id: primary.id,
      type: 'plan_created',
      title: 'Demo data is ready',
      body: 'Your Planazo demo circles now have plans, RSVPs, and flexible dates.',
      data: { seed: 'demo', plan_id: plansByKey.get('board-games')?.id || '' },
      read: false,
    },
  ];

  const { error } = await supabase.from('notifications').insert(rows);
  if (error) throw error;
}

async function main() {
  await assertSchemaExists();

  const initialAuthUsers = await listAuthUsers();
  const demoEmails = new Set(demoUsers.map((user) => user.email.toLowerCase()));
  const existingPeople = initialAuthUsers
    .filter((user) => user.email && !demoEmails.has(user.email.toLowerCase()))
    .map((user) => ({
      handle: `existing-${user.id}`,
      id: user.id,
      email: user.email,
      displayName: displayNameForAuthUser(user),
    }));

  const demoPeople = await ensureDemoUsers(initialAuthUsers);
  const selectedPrimaryEmail = process.env.SEED_PRIMARY_EMAIL?.trim().toLowerCase();
  const allPeople = uniqueById([...existingPeople, ...demoPeople]);
  const primary =
    allPeople.find((person) => person.email.toLowerCase() === selectedPrimaryEmail) ||
    existingPeople[0] ||
    demoPeople[0];

  if (!primary) {
    throw new Error('No primary user could be selected for demo memberships.');
  }

  const peopleByHandle = new Map(demoPeople.map((person) => [person.handle, person]));

  await upsertProfiles(allPeople);
  const groupsByKey = await upsertGroups(primary.id);
  await upsertMemberships(groupsByKey, primary, peopleByHandle);
  await deleteExistingDemoPlans(groupsByKey);

  const planDefinitions = makePlanDefinitions();
  const plansByKey = await insertPlans(planDefinitions, groupsByKey, primary);
  await insertFixedPlanRsvps(planDefinitions, plansByKey, primary, peopleByHandle);
  await insertFlexiblePlanData(planDefinitions, plansByKey, primary, peopleByHandle);
  await insertNotifications(primary, plansByKey);

  console.log('Demo seed complete.');
  console.log(`Primary demo account: ${primary.email}`);
  console.log(`Dedicated demo login: demo.planazo@example.com`);
  console.log(`Demo user password: ${DEMO_PASSWORD}`);
  console.log(`Groups: ${demoGroups.map((group) => group.name).join(', ')}`);
  console.log(`Plans: ${planDefinitions.length}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
