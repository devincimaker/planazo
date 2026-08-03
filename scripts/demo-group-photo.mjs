// Puts this checkout's database into the state group photos need to be seen
// (PLA-30): the demo account runs two groups, one of which already has a photo
// so you can see the tile everywhere without uploading anything first, and one
// of which is deliberately still on its letter so you can add one yourself.
//
// Runs on top of `pnpm db:seed:demo`, whose accounts and groups it reuses.
// Idempotent: it rebuilds both groups' photo state every time, so you can go
// round the walkthrough as often as you like.
import path from 'node:path';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { renderPng } from './render-html.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../.env') });

const BUCKET = 'group-images';
/** Gets a photo, so its tile stops being a letter everywhere. */
const WITH_PHOTO = 'Food & Drinks';
/** Stays on its letter, so there is something left for you to do. */
const WITHOUT_PHOTO = 'Weekend Crew';

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const supabaseUrl = requiredEnv('SUPABASE_URL').replace(/\/+$/, '');

// This script rewrites group rows and deletes storage objects with the service
// role. A worktree whose .env was copied from the primary but never repointed
// would aim all of that at production, so the live ref has to be asked for
// explicitly — same guard, same flag and same two refs as seed-demo-data.mjs,
// since a stale .env pointing at the retired project is just as damaging.
const PRODUCTION_REFS = ['leszgvpjonzjclhbgzju', 'lmgjdvacivzzhctgctqa'];
const hitRef = PRODUCTION_REFS.find((ref) => supabaseUrl.includes(ref));
if (hitRef && process.env.SEED_ALLOW_PRODUCTION !== 'yes') {
  throw new Error(
    `Refusing to touch PRODUCTION (${hitRef}).\n` +
      `SUPABASE_URL is ${supabaseUrl}.\n` +
      `If that is genuinely what you want: SEED_ALLOW_PRODUCTION=yes pnpm demo:group-photo`,
  );
}

console.log(`Target: ${supabaseUrl}`);

const svc = createClient(supabaseUrl, requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});

function ok(res) {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

const { data: userPage, error: userError } = await svc.auth.admin.listUsers({ perPage: 200 });
if (userError) throw new Error(userError.message);
const demo = userPage.users.find((u) => u.email === 'demo.planazo@example.com');
if (!demo) throw new Error('No demo.planazo@example.com. Run `pnpm db:seed:demo` first.');

async function groupNamed(name) {
  const rows = ok(await svc.from('groups').select('id, name').eq('name', name));
  if (!rows.length) throw new Error(`No "${name}" group. Run \`pnpm db:seed:demo\` first.`);
  return rows[0];
}

const [photoGroup, letterGroup] = await Promise.all([
  groupNamed(WITH_PHOTO),
  groupNamed(WITHOUT_PHOTO),
]);

// Only admins get the "Group profile" row, and only admins may write the photo.
for (const group of [photoGroup, letterGroup]) {
  ok(
    await svc
      .from('group_members')
      .upsert(
        { group_id: group.id, user_id: demo.id, role: 'admin' },
        { onConflict: 'group_id,user_id' },
      ),
  );
}

/**
 * Nothing in Planazo is hand-drawn, so the demo photo is rendered from the
 * tokens like every other asset in this repo (see build-brand-assets.mjs).
 * It only has to be obviously a photograph rather than a letter on a tile.
 */
const out = path.join(tmpdir(), `planazo-group-photo-${process.pid}.png`);
renderPng({
  width: 600,
  height: 600,
  body: `<div class="frame">
    <div class="glow a"></div>
    <div class="glow b"></div>
    <div class="glow c"></div>
  </div>`,
  css: `
    .frame {
      width: 600px; height: 600px; position: relative; overflow: hidden;
      background: linear-gradient(145deg, #F6C453 0%, #F2542D 55%, #C43B18 100%);
    }
    .glow { position: absolute; border-radius: 50%; filter: blur(46px); }
    .a { width: 340px; height: 340px; left: -70px; top: -60px; background: rgba(252,248,244,.55); }
    .b { width: 300px; height: 300px; right: -60px; top: 130px; background: rgba(247,176,220,.6); }
    .c { width: 260px; height: 260px; left: 150px; bottom: -90px; background: rgba(20,160,107,.45); }
  `,
  out,
});

// The object is named cover.jpg because that is the one name per group the app
// writes and overwrites (lib/images.ts). The bytes here are a PNG, and the
// content type says so — the extension is a name, the header is the contract.
const path_ = `${photoGroup.id}/cover.jpg`;
ok(
  await svc.storage
    .from(BUCKET)
    .upload(path_, readFileSync(out), { upsert: true, contentType: 'image/png' }),
);
rmSync(out, { force: true });

const { data: pub } = svc.storage.from(BUCKET).getPublicUrl(path_);
ok(
  await svc
    .from('groups')
    .update({ image_url: `${pub.publicUrl}?t=${Date.now()}` })
    .eq('id', photoGroup.id),
);

// And the other one goes back to its letter, however the last run left it.
ok(await svc.from('groups').update({ image_url: null }).eq('id', letterGroup.id));
// remove() reports failures in `error` rather than throwing, and this script
// is about to claim the group is back to its letter.
ok(await svc.storage.from(BUCKET).remove([`${letterGroup.id}/cover.jpg`]));

console.log('Group photo demo ready.');
console.log(`  ${WITH_PHOTO}: has a photo, and you are an admin (try Change and Remove)`);
console.log(`  ${WITHOUT_PHOTO}: still a letter, and you are an admin (try Add a photo)`);
console.log('Sign in as demo.planazo@example.com / Planazo123!');
