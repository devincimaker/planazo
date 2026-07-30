import { execSync } from 'node:child_process';

export interface LocalStack {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

let cached: LocalStack | null = null;

/**
 * The suite signs up throwaway users and mutates rows freely, so it must only
 * ever talk to the local Supabase stack. Anything that doesn't look like a
 * loopback URL is refused outright.
 */
function assertLocal(url: string): void {
  const host = new URL(url).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(`Integration tests only run against a local Supabase stack, got ${url}`);
  }
}

export function localStack(): LocalStack {
  if (cached) return cached;

  let url = process.env.SUPABASE_URL;
  let anonKey = process.env.SUPABASE_ANON_KEY;
  let serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
  }

  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error(
      'Local Supabase stack not found — run `supabase start` first ' +
        '(or set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY).',
    );
  }

  assertLocal(url);
  cached = { url, anonKey, serviceRoleKey };
  return cached;
}
