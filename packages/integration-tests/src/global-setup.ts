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

  const missing = fileVersions.filter((v) => !applied.has(v));
  if (missing.length) {
    const isLocal = stack.dbUrl.includes('127.0.0.1') || stack.dbUrl.includes('localhost');
    throw new Error(
      `The target database is missing ${missing.length} migration(s) from this checkout: ` +
        `${missing.join(', ')}.\nApply them first: ` +
        (isLocal
          ? 'supabase migration up'
          : 'supabase db push --db-url "$SUPABASE_DB_URL"  (from this worktree, or re-run pnpm wt:setup --db)'),
    );
  }
}
