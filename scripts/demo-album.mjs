// Puts this checkout's database into the three states the album is drawn in
// (PLA-32): a plan whose night has already started with no photos, one with a
// single photo, and one with enough that the card collapses to a strip and a
// count.
//
// Runs on top of `pnpm db:seed:demo`, whose accounts and groups it reuses.
// Idempotent: it deletes and rebuilds its own three plans every time.
//
// Photos are uploaded **as the people who took them**, through a normal signed
// in session, not with the service role. That is the point: it exercises the
// storage policies and sets `owner`, so the uploader can delete their own
// photo afterwards exactly as they could in the app. A service-role upload
// would prove the bucket exists and nothing else.
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../.env') });

const GROUP_NAME = 'Weekend Crew';
const PASSWORD = process.env.SEED_DEMO_PASSWORD || 'Planazo123!';

// Photos are given as indexes into this group's own member list, resolved at
// run time. Naming accounts here instead was how the first version broke: it
// picked an uploader who is not in Weekend Crew, and the storage policy
// refused them, correctly.
const PLANS = [
  { title: 'Asado en Escobar', photos: [] },
  { title: 'Cinema, late showing', photos: [1] },
  {
    title: 'Sunday at the lake',
    // Five distinct uploaders so the summary reads "from five people".
    photos: [
      ...Array(9).fill(1),
      ...Array(8).fill(2),
      ...Array(7).fill(3),
      ...Array(6).fill(4),
      ...Array(5).fill(0),
    ],
  },
];

// Planazo's group identity palette, so the seeded album looks deliberate
// rather than like test data.
const SWATCHES = ['#F7B0DC', '#8FC7E8', '#F6C453', '#B7E4C7', '#E5D4F5'];

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const URL = requiredEnv('SUPABASE_URL').replace(/\/+$/, '');
const svc = createClient(URL, requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});

function ok(res) {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

// --------------------------------------------------------------- image bytes
//
// The bucket only accepts image/jpeg and there is no JPEG in this repo to
// borrow, so make one: a solid PNG written by hand (zlib is in node, a solid
// image is one filter byte plus a run of pixels per row) and handed to `sips`
// to re-encode. macOS only, which is where the simulator lives anyway.

function solidPng(hex, size = 900) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const row = Buffer.alloc(1 + size * 3);
  for (let x = 0; x < size; x++) {
    row[1 + x * 3] = r;
    row[2 + x * 3] = g;
    row[3 + x * 3] = b;
  }
  const raw = Buffer.concat(Array.from({ length: size }, () => row));

  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const workDir = mkdtempSync(path.join(tmpdir(), 'planazo-album-'));
const jpegs = SWATCHES.map((hex, i) => {
  const png = path.join(workDir, `tile-${i}.png`);
  const jpg = path.join(workDir, `tile-${i}.jpg`);
  writeFileSync(png, solidPng(hex));
  execFileSync('sips', ['-s', 'format', 'jpeg', png, '--out', jpg], { stdio: 'ignore' });
  return readFileSync(jpg);
});

// ------------------------------------------------------------------- accounts

const { data: userPage, error: userError } = await svc.auth.admin.listUsers({ perPage: 200 });
if (userError) throw new Error(userError.message);
const idFor = (email) => {
  const user = userPage.users.find((u) => u.email === email);
  if (!user) throw new Error(`No ${email}. Run \`pnpm db:seed:demo\` first.`);
  return user.id;
};

const group = ok(await svc.from('groups').select('id, name').eq('name', GROUP_NAME).single());
const members = ok(
  await svc
    .from('group_members')
    .select('user_id, profiles:profiles(email)')
    .eq('group_id', group.id),
);
const memberIds = members.map((m) => m.user_id);

// Index 0 is the demo account, so it owns some of the photos in the busy
// album and can delete them in the walkthrough. Everyone else follows in
// whatever order the group returns.
const emails = members.map((m) => m.profiles?.email).filter(Boolean);
const roster = [
  ...emails.filter((e) => e === 'demo.planazo@example.com'),
  ...emails.filter((e) => e !== 'demo.planazo@example.com'),
];
if (roster.length < 5) {
  throw new Error(`${GROUP_NAME} needs 5 members to seed five uploaders, found ${roster.length}.`);
}

// The host is a member other than the demo account, so the walkthrough sees a
// plan somebody else posted.
const host = idFor(roster[1]);

// Sessions, one per uploader, reused across their photos.
const sessions = new Map();
async function clientFor(email) {
  if (!sessions.has(email)) {
    const anon = createClient(URL, requiredEnv('SUPABASE_ANON_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
    if (error) throw new Error(`Could not sign in as ${email}: ${error.message}`);
    sessions.set(email, anon);
  }
  return sessions.get(email);
}

// ---------------------------------------------------------------------- plans

const yesterday = new Date(Date.now() - 20 * 3600 * 1000).toISOString();

for (const [index, spec] of PLANS.entries()) {
  // Rebuild from scratch. Photos cascade with the plan, but the objects do
  // not, so clear those first while the rows still name them.
  const existing = ok(
    await svc.from('plans').select('id').eq('group_id', group.id).eq('title', spec.title),
  );
  for (const plan of existing) {
    const rows = ok(await svc.from('plan_photos').select('storage_path').eq('plan_id', plan.id));
    if (rows.length) {
      await svc.storage.from('plan-photos').remove(rows.map((r) => r.storage_path));
    }
    ok(await svc.from('plans').delete().eq('id', plan.id));
  }

  const plan = ok(
    await svc
      .from('plans')
      .insert({
        group_id: group.id,
        created_by: host,
        title: spec.title,
        description: index === 0 ? "Nacho's place. Bring something for the grill." : null,
        plan_type: 'fixed',
        event_date: yesterday,
        location: index === 0 ? 'Escobar' : null,
        min_people: 2,
        status: 'open',
      })
      .select('id')
      .single(),
  );

  // Everyone in, so the demo account can add photos and the plan reads as
  // confirmed rather than as a night that did not happen.
  ok(
    await svc
      .from('rsvps')
      .upsert(
        memberIds.map((user_id) => ({ plan_id: plan.id, user_id, response: 'yes' })),
        { onConflict: 'plan_id,user_id' },
      ),
  );

  // Row first, then the object: the same order the app uses, and the reason
  // an interrupted run leaves a visible row rather than an invisible file.
  for (const [n, who] of spec.photos.entries()) {
    const email = roster[who];
    const client = await clientFor(email);
    const uploader = idFor(email);
    const storage_path = `${plan.id}/${uploader}/${Date.now().toString(36)}${n}.jpg`;

    const { error: rowError } = await client
      .from('plan_photos')
      .insert({ plan_id: plan.id, uploaded_by: uploader, storage_path, width: 900, height: 900 });
    if (rowError) throw new Error(`Row insert failed for ${email}: ${rowError.message}`);

    const { error: upError } = await client.storage
      .from('plan-photos')
      .upload(storage_path, jpegs[n % jpegs.length], { contentType: 'image/jpeg' });
    if (upError) throw new Error(`Upload failed for ${email}: ${upError.message}`);
  }

  console.log(`${spec.title}: ${spec.photos.length} photo(s)`);
}

rmSync(workDir, { recursive: true, force: true });

console.log(`
Done. Sign in as demo.planazo@example.com / ${PASSWORD} and open ${GROUP_NAME}:

  Asado en Escobar      empty album, the placeholder and the button
  Cinema, late showing  one photo, the 4:3 hero and who took it
  Sunday at the lake    35 photos from five people, strip and chevron
`);
