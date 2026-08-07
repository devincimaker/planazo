import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Stack {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  /**
   * HS256 secret the stack's auth server signs access tokens with; testbed.ts
   * mints the suite's own tokens from it instead of calling the rate-limited
   * sign-in endpoint (PLA-84).
   */
  jwtSecret: string;
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

/** Parsed `supabase status -o env` output, or null when no local stack answers. */
function statusEnv(): Record<string, string> | null {
  try {
    const out = execSync('supabase status -o env', { encoding: 'utf8' });
    const vars: Record<string, string> = {};
    for (const line of out.split('\n')) {
      const m = line.match(/^([A-Z_]+)="(.*)"$/);
      if (m) vars[m[1]] = m[2];
    }
    return vars;
  } catch {
    return null;
  }
}

/** The `<ref>` of an `https://<ref>.supabase.co` URL, or null. */
function hostedRef(url: string): string | null {
  const m = new URL(url).hostname.match(/^([a-z]{20})\.supabase\.co$/);
  return m ? m[1] : null;
}

/**
 * The suite signs up throwaway users and mutates rows freely, so it may only
 * target the ONE database this checkout owns, decided by its declared mode:
 *   - branch mode (.env.worktree says PLANAZO_DB_MODE=branch): only this
 *     worktree's own branch database, ref-matched against PLANAZO_BRANCH_REF.
 *     Loopback is refused too — wt:setup --db records the mode before it
 *     rewrites .env, so a setup that died midway leaves a branch-mode worktree
 *     still pointing at main's stack. Running there would test main's schema
 *     while claiming branch isolation.
 *   - everything else (shared worktrees, main, CI): only loopback.
 * Anything unverifiable is refused: fail closed.
 */
function assertAllowed(url: string, root: string): void {
  const worktree = parseEnvFile(join(root, '.env.worktree'));
  const mode = worktree.PLANAZO_DB_MODE ?? '';
  const ownRef = worktree.PLANAZO_BRANCH_REF ?? '';
  const ref = hostedRef(url);

  if (mode === 'branch') {
    if (ref && ownRef && ref === ownRef) return;
    throw new Error(
      `Refusing to run integration tests against ${url}.\n` +
        `This worktree declares PLANAZO_DB_MODE=branch, so the suite only accepts its ` +
        `own branch database` +
        (ownRef ? ` (ref '${ownRef}')` : '') +
        `.\n` +
        (isLoopback(url)
          ? `A loopback URL here usually means wt:setup --db failed before rewriting .env,\n` +
            `leaving this checkout pointed at main's local stack.\n`
          : ownRef
            ? `This URL's ref does not match.\n`
            : `No PLANAZO_BRANCH_REF is recorded, so no database can be verified as this worktree's.\n`) +
        `Re-run: pnpm wt:setup --db`,
    );
  }

  if (isLoopback(url)) return;

  throw new Error(
    `Refusing to run integration tests against ${url}.\n` +
      `This checkout is not a branch-mode worktree, so the suite only targets a ` +
      `loopback stack.\n` +
      `If you exported SUPABASE_URL by sourcing the wrong .env, unset it — the suite\n` +
      `reads this checkout's root .env on its own. If this worktree should have its\n` +
      `own database, run: pnpm wt:setup --db`,
  );
}

/**
 * Base URL of the local mail catcher, or null when this stack has none.
 *
 * Only a loopback stack runs one: a hosted branch database sends real email
 * through Supabase's mailer, where nothing can read it back. Tests that need to
 * see what a user received skip themselves when this returns null, rather than
 * failing on a machine that was never going to be able to answer.
 *
 * The port is read from config.toml rather than hardcoded, because that file is
 * the thing the CLI actually obeys.
 */
export function mailCatcher(): string | null {
  if (!isLoopback(resolveStack().url)) return null;

  const config = readFileSync(join(repoRoot(), 'supabase', 'config.toml'), 'utf8');
  // Everything from [inbucket] up to the next section header.
  const section = config.split(/^\[inbucket\]\s*$/m)[1]?.split(/^\[/m)[0];
  if (!section || !/^enabled\s*=\s*true/m.test(section)) return null;

  const port = section.match(/^port\s*=\s*(\d+)/m)?.[1];
  return port ? `http://127.0.0.1:${port}` : null;
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
  let jwtSecret = process.env.SUPABASE_JWT_SECRET ?? null;
  let dbUrl = process.env.SUPABASE_DB_URL ?? null;

  if (!url || !anonKey || !serviceRoleKey) {
    const env = parseEnvFile(join(root, '.env'));
    if (env.SUPABASE_URL && env.SUPABASE_ANON_KEY && env.SUPABASE_SERVICE_ROLE_KEY) {
      url = env.SUPABASE_URL;
      anonKey = env.SUPABASE_ANON_KEY;
      serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
      jwtSecret = env.SUPABASE_JWT_SECRET ?? null;
      dbUrl = env.SUPABASE_DB_URL ?? null;
    } else {
      url = anonKey = serviceRoleKey = undefined;
    }
  }

  if (!url || !anonKey || !serviceRoleKey) {
    const vars = statusEnv() ?? {};
    url = vars.API_URL;
    anonKey = vars.ANON_KEY;
    serviceRoleKey = vars.SERVICE_ROLE_KEY;
    jwtSecret = vars.JWT_SECRET ?? null;
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

  // Loopback targets can answer for their own DB_URL and JWT_SECRET via
  // `supabase status` — an older .env (written before either key existed)
  // is not a reason to refuse a run the stack itself can satisfy.
  if ((!dbUrl || !jwtSecret) && isLoopback(url)) {
    const vars = statusEnv();
    dbUrl = dbUrl ?? vars?.DB_URL ?? null;
    jwtSecret = jwtSecret ?? vars?.JWT_SECRET ?? null;
  }

  // A hosted branch has no equivalent fallback: the secret only travels through
  // wt:setup, so a worktree provisioned before PLA-84 refuses with the fix
  // rather than failing later inside a test file.
  if (!jwtSecret) {
    throw new Error(
      `No SUPABASE_JWT_SECRET found for ${url}.\n` +
        `The suite signs its own access tokens instead of calling the rate-limited\n` +
        `auth endpoint, and needs the stack's JWT secret to do it.\n` +
        (isLoopback(url)
          ? `Loopback answers via \`supabase status\` — is the stack up (supabase start)?\n` +
            `A worktree can also refresh its .env with: pnpm wt:setup`
          : `Re-run: pnpm wt:setup --db (rewrites this worktree's .env with the secret)`),
    );
  }

  cached = { url, anonKey, serviceRoleKey, jwtSecret, dbUrl };
  return cached;
}
