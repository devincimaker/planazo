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
    // Pre-dates wt:setup writing SUPABASE_DB_URL. The ownership guard already
    // passed, so run rather than block — but say what we couldn't verify.
    console.warn(
      '[integration-tests] No SUPABASE_DB_URL for this hosted database — skipping the ' +
        'schema drift check. Re-run `pnpm wt:setup --db` to record it.',
    );
    return;
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
