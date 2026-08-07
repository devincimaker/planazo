import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@planazo/shared';
import { createHmac, randomUUID } from 'node:crypto';
import { resolveStack } from './env';

export type Client = SupabaseClient<Database>;

export interface TestUser {
  id: string;
  email: string;
  name: string;
  client: Client;
}

function newServiceClient(): Client {
  const { url, serviceRoleKey } = resolveStack();
  return createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * HS256-signs an access token for an existing auth user, as the stack's auth
 * server would: same secret, and the claims this schema reads — auth.uid()'s
 * `sub`, PostgREST's `role`, plus `email` for parity with a real session — so
 * Postgres accepts it exactly as it accepts a sign-in's. If a policy ever
 * reads more of auth.jwt(), add the claim here. Signing locally is what keeps
 * the suite off the password-grant endpoint, whose hosted rate limit
 * (~30/5min, platform-level, unraisable) used to fail runs from branch-DB
 * worktrees (PLA-84). Every test in the suite exercises this against the real
 * verifier — a wrong claim or signature is an instant 401 everywhere.
 */
function mintAccessToken(userId: string, email: string): string {
  const { jwtSecret } = resolveStack();
  const b64 = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    sub: userId,
    email,
    role: 'authenticated',
    aud: 'authenticated',
    iat: now,
    exp: now + 3600,
  })}`;
  const sig = createHmac('sha256', jwtSecret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/**
 * A client locked to one minted token. `accessToken` hands the token to
 * PostgREST, Storage and Realtime alike, and disables the client's auth API —
 * which is the point: an actor's client should query as that actor and
 * nothing else.
 */
function newUserClient(userId: string, email: string): Client {
  const { url, anonKey } = resolveStack();
  const token = mintAccessToken(userId, email);
  return createClient<Database>(url, anonKey, { accessToken: async () => token });
}

/** Throws unless the supabase-js response is error-free; returns the data. */
export function ok<T>(res: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (res.error) throw new Error(res.error.message);
  return res.data as NonNullable<T>;
}

/**
 * Per-file factory for users/groups that tracks what it created and tears it
 * all down in dispose(). Every actor holds its own authenticated client under
 * a token minted for that actor alone — the service role creates the account
 * and tears it down, and does nothing on an actor's behalf in between.
 */
export class TestBed {
  readonly service: Client = newServiceClient();
  private users: TestUser[] = [];
  private groupIds: string[] = [];

  /**
   * Deliberately neither signUp nor signInWithPassword: signUp would tie the
   * suite to the product's email policy (PLA-71), and sign-in is what hosted
   * stacks throttle (PLA-84 — see mintAccessToken). The admin API creates the
   * account pre-confirmed — the trigger on auth.users fires the same on an
   * admin insert, so profile and handle are built exactly as a real signup
   * builds them — and the actor's token is minted locally. The real auth flow
   * keeps its coverage in signup-confirmation.test.ts, where it is the
   * subject, not the setup.
   */
  async createUser(name?: string): Promise<TestUser> {
    const email = `it-${randomUUID()}@example.com`;
    const { data, error } = await this.service.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: name ? { display_name: name } : undefined,
    });
    if (error || !data.user) {
      // The one auth endpoint still in the setup path. A throttle here must
      // say so, or it reads as a failure of whichever test file hit it first.
      if (error && (error.status === 429 || error.code === 'over_request_rate_limit')) {
        throw new Error(
          `Supabase auth rate limit reached while creating ${email} via admin.createUser.\n` +
            `This is the platform throttling this stack's auth endpoint, not a failing test.\n` +
            `Wait a few minutes and re-run; if it recurs, check what else is hammering\n` +
            `this database's auth API (${resolveStack().url}).`,
        );
      }
      throw new Error(
        `admin.createUser failed for ${email}: ${error?.message ?? 'no user returned'}`,
      );
    }
    const user = {
      id: data.user.id,
      email,
      name: name ?? email.split('@')[0],
      client: newUserClient(data.user.id, email),
    };
    this.users.push(user);
    return user;
  }

  /**
   * Registers a group this bed did not create for teardown. Tests that call
   * create_group directly need this: dispose() must drop the group before the
   * creator's profile, which groups.created_by still points at.
   */
  trackGroup(id: string) {
    this.groupIds.push(id);
  }

  /** Creates a group the way the app does: one create_group call that also seats the owner as admin. */
  async createGroup(owner: TestUser, opts: { name?: string; anyone_can_post?: boolean } = {}) {
    const group = ok(
      await owner.client.rpc('create_group', {
        p_name: opts.name ?? `it-group-${randomUUID().slice(0, 8)}`,
      }),
    );
    this.groupIds.push(group.id);
    // anyone_can_post is not a create_group argument — the app sets it later
    // from the manage screen, and so do we.
    if (opts.anyone_can_post === false) {
      ok(await owner.client.from('groups').update({ anyone_can_post: false }).eq('id', group.id));
    }
    return group;
  }

  /**
   * Joins by invite code — the real app path (PLA-35), so every test's setup
   * exercises it. `role` exists only for the rare fixture that needs a second
   * admin: no client path can grant that, so it goes through the service role.
   */
  async join(groupId: string, user: TestUser, role: 'admin' | 'member' = 'member') {
    if (role === 'admin') {
      ok(
        await this.service
          .from('group_members')
          .insert({ group_id: groupId, user_id: user.id, role: 'admin' }),
      );
      return;
    }

    const { invite_code } = ok(
      await this.service.from('groups').select('invite_code').eq('id', groupId).single(),
    );
    const res = ok(await user.client.rpc('join_group_by_invite_code', { p_code: invite_code })) as {
      status: string;
    };
    if (res.status !== 'joined') {
      throw new Error(`join_group_by_invite_code returned ${res.status} for ${user.email}`);
    }
  }

  /** Deletes everything this bed created. Groups first: profiles can't go while groups.created_by points at them. */
  async dispose() {
    if (this.groupIds.length) {
      await this.service.from('groups').delete().in('id', this.groupIds);
    }
    for (const u of this.users) {
      await this.service.auth.admin.deleteUser(u.id);
    }
  }
}

/** ISO timestamp `days` from now (positive = future). */
export function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}
