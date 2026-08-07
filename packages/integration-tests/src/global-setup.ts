import { execSync } from 'node:child_process';
import { Client } from 'pg';
import { repoRoot, resolveStack } from './env';

/**
 * Runs once per suite invocation, before any test file. The guard in env.ts
 * proves the target is OURS; this proves it is CURRENT: every migration file in
 * this checkout must already be applied to the target database, or the verdict
 * would be about a schema nobody is shipping. This is exactly the failure that
 * bit main on 2026-08-01, when a merged migration existed in the checkout but
 * had never been applied to the local stack.
 */
export default async function globalSetup(): Promise<void> {
  const stack = resolveStack();

  // Hand the resolved stack to the workers. Each test file re-runs
  // resolveStack() in its own module graph, and process.env is its first
  // source — inherited by every worker spawned after this point — so an .env
  // predating SUPABASE_JWT_SECRET or SUPABASE_DB_URL costs one `supabase
  // status` here instead of one per file (PLA-84).
  process.env.SUPABASE_URL = stack.url;
  process.env.SUPABASE_ANON_KEY = stack.anonKey;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.SUPABASE_JWT_SECRET = stack.jwtSecret;
  if (stack.dbUrl) process.env.SUPABASE_DB_URL = stack.dbUrl;

  if (!stack.dbUrl) {
    // No Postgres URL means the drift check cannot run, and a verdict about an
    // unverifiable schema is worth nothing — refuse, same as every other
    // unverifiable state. Worktrees from before wt:setup recorded
    // SUPABASE_DB_URL land here until re-run.
    throw new Error(
      'No Postgres URL for the target database, so the schema drift check cannot run — ' +
        'refusing to vouch for a schema it cannot see.\n' +
        'Branch worktree: re-run `pnpm wt:setup --db` to record SUPABASE_DB_URL in .env.\n' +
        'Loopback: make sure the local stack is up (`supabase start` from main).',
    );
  }

  const files = execSync('ls supabase/migrations', { cwd: repoRoot(), encoding: 'utf8' })
    .split('\n')
    .filter((f) => f.endsWith('.sql'));
  const fileVersions = files.map((f) => f.split('_')[0]);

  const client = new Client({ connectionString: stack.dbUrl, connectionTimeoutMillis: 10_000 });
  let applied: Set<string>;
  try {
    await client.connect();
    const res = await client.query('select version from supabase_migrations.schema_migrations');
    applied = new Set(res.rows.map((r: { version: string }) => r.version));
  } finally {
    await client.end().catch(() => {});
  }

  const isLocal = stack.dbUrl.includes('127.0.0.1') || stack.dbUrl.includes('localhost');

  const missing = fileVersions.filter((v) => !applied.has(v));
  if (missing.length) {
    throw new Error(
      `The target database is missing ${missing.length} migration(s) from this checkout: ` +
        `${missing.join(', ')}.\nApply them first: ` +
        (isLocal
          ? 'supabase migration up'
          : 'supabase db push --db-url "$SUPABASE_DB_URL"  (from this worktree, or re-run pnpm wt:setup --db)'),
    );
  }

  // Version equality is not content equality: `db push` skips a recorded
  // version even when its file changed, so an applied migration edited on disk
  // silently never reaches the database. The full case is unverifiable (the
  // history table does not store file bytes), but the common moment — edit an
  // applied migration, immediately re-run the tests — is git-observable.
  // Edits that were committed and never re-applied stay a local blind spot;
  // CI's fresh stack always tests the true content and remains the merge gate.
  const dirtyApplied = execSync('git status --porcelain -- supabase/migrations', {
    cwd: repoRoot(),
    encoding: 'utf8',
  })
    .split('\n')
    .filter((l) => l.length > 3 && !l.startsWith('??'))
    .map((l) => l.slice(3).split(' -> ').pop() ?? '')
    .filter((p) => applied.has((p.split('/').pop() ?? '').split('_')[0]));
  if (dirtyApplied.length) {
    throw new Error(
      `Applied migration(s) have uncommitted edits: ${dirtyApplied.join(', ')}.\n` +
        `The database is still running the OLD content — 'db push' matches by version ` +
        `and skips them.\nRe-apply everything: ` +
        (isLocal
          ? 'supabase db reset  (from main — wipes shared QA data)'
          : 'pnpm wt:db:reset  (wipes and rebuilds this worktree\'s branch database)'),
    );
  }
}
