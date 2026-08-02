import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Stack {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  /** Direct Postgres URL for the same database, when known. Drift checks only. */
  dbUrl: string | null;
}

let cached: Stack | null = null;

export function repoRoot(): string {
  return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
}

/** KEY=VALUE lines; comments and blanks skipped; surrounding quotes stripped. */
function parseEnvFile(path: string): Record<string, string> {
  const vars: Record<string, string> = {};
  if (!existsSync(path)) return vars;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) vars[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
  return vars;
}

function isLoopback(url: string): boolean {
  const host = new URL(url).hostname;
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

/** The `<ref>` of an `https://<ref>.supabase.co` URL, or null. */
function hostedRef(url: string): string | null {
  const m = new URL(url).hostname.match(/^([a-z]{20})\.supabase\.co$/);
  return m ? m[1] : null;
}

/**
 * The suite signs up throwaway users and mutates rows freely, so it may only
 * target a database this checkout owns:
 *   - a loopback stack (main's local stack, or CI's), or
 *   - THIS worktree's own Supabase branch database, identified by comparing the
 *     URL's project ref against PLANAZO_BRANCH_REF in .env.worktree.
 * Anything else — production, another worktree's branch, anything we cannot
 * verify — is refused. Unverifiable means refused: fail closed.
 */
function assertAllowed(url: string, root: string): void {
  if (isLoopback(url)) return;

  const ref = hostedRef(url);
  const worktree = parseEnvFile(join(root, '.env.worktree'));
  const ownRef = worktree.PLANAZO_BRANCH_REF ?? '';

  if (ref && ownRef && ref === ownRef) return;

  throw new Error(
    `Refusing to run integration tests against ${url}.\n` +
      `The suite only targets a loopback stack or this worktree's own branch database.\n` +
      (ownRef
        ? `This worktree's branch ref is '${ownRef}', which does not match.\n`
        : `This checkout has no .env.worktree with a PLANAZO_BRANCH_REF, so no hosted database belongs to it.\n`) +
      `If you exported SUPABASE_URL by sourcing the wrong .env, unset it — the suite\n` +
      `reads this checkout's root .env on its own. If this worktree should have its\n` +
      `own database, run: pnpm wt:setup --db`,
  );
}

/**
 * A shared-mode worktree's database is main's local stack, which carries main's
 * schema. A branch that adds migration files would be testing against a schema
 * it isn't shipping — refuse before it produces a meaningless verdict.
 */
function assertNoSchemaSkew(root: string): void {
  const worktree = parseEnvFile(join(root, '.env.worktree'));
  if (worktree.PLANAZO_DB_MODE !== 'shared') return;

  let onMain: string;
  try {
    onMain = execSync('git ls-tree -r --name-only origin/main -- supabase/migrations', {
      cwd: root,
      encoding: 'utf8',
    });
  } catch {
    return; // origin/main unavailable (offline, shallow clone) — the drift check still runs
  }
  const known = new Set(onMain.split('\n').filter(Boolean).map((p) => p.split('/').pop()));
  const local = execSync('ls supabase/migrations', { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((f) => f.endsWith('.sql'));
  const added = local.filter((f) => !known.has(f));
  if (added.length) {
    throw new Error(
      `This branch adds migrations (${added.join(', ')}) but the worktree is in shared\n` +
        `DB mode, so the suite would run against main's schema and prove nothing.\n` +
        `Give this worktree its own database first: pnpm wt:setup --db`,
    );
  }
}

/**
 * Resolution order — the first source providing all three keys wins, so values
 * are never mixed across sources:
 *   1. process.env (CI or an explicit override)
 *   2. the checkout's root .env (written by wt:setup; main's points at its local stack)
 *   3. `supabase status` (a bare checkout with a running local stack)
 */
export function resolveStack(): Stack {
  if (cached) return cached;
  const root = repoRoot();

  let url = process.env.SUPABASE_URL;
  let anonKey = process.env.SUPABASE_ANON_KEY;
  let serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let dbUrl = process.env.SUPABASE_DB_URL ?? null;

  if (!url || !anonKey || !serviceRoleKey) {
    const env = parseEnvFile(join(root, '.env'));
    if (env.SUPABASE_URL && env.SUPABASE_ANON_KEY && env.SUPABASE_SERVICE_ROLE_KEY) {
      url = env.SUPABASE_URL;
      anonKey = env.SUPABASE_ANON_KEY;
      serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
      dbUrl = env.SUPABASE_DB_URL ?? null;
    } else {
      url = anonKey = serviceRoleKey = undefined;
    }
  }

  if (!url || !anonKey || !serviceRoleKey) {
    const out = execSync('supabase status -o env', { encoding: 'utf8' });
    const vars: Record<string, string> = {};
    for (const line of out.split('\n')) {
      const m = line.match(/^([A-Z_]+)="(.*)"$/);
      if (m) vars[m[1]] = m[2];
    }
    url = vars.API_URL;
    anonKey = vars.ANON_KEY;
    serviceRoleKey = vars.SERVICE_ROLE_KEY;
    dbUrl = vars.DB_URL ?? null;
  }

  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error(
      'No database found for this checkout — expected SUPABASE_URL, SUPABASE_ANON_KEY\n' +
        'and SUPABASE_SERVICE_ROLE_KEY in the environment or the root .env, or a running\n' +
        'local stack (`supabase start`). In a worktree, `pnpm wt:setup` writes .env.',
    );
  }

  assertAllowed(url, root);
  assertNoSchemaSkew(root);

  // Loopback targets always have a queryable DB_URL via `supabase status`.
  if (!dbUrl && isLoopback(url)) {
    try {
      const out = execSync('supabase status -o env', { encoding: 'utf8' });
      dbUrl = out.match(/^DB_URL="(.*)"$/m)?.[1] ?? null;
    } catch {
      dbUrl = null;
    }
  }

  cached = { url, anonKey, serviceRoleKey, dbUrl };
  return cached;
}
