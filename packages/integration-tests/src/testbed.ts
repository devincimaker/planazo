import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@planazo/shared';
import { randomUUID } from 'node:crypto';
import { resolveStack } from './env';

export type Client = SupabaseClient<Database>;

export interface TestUser {
  id: string;
  email: string;
  name: string;
  client: Client;
}

const PASSWORD = 'Planazo123!';

function newClient(key: string): Client {
  const { url } = resolveStack();
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Throws unless the supabase-js response is error-free; returns the data. */
export function ok<T>(res: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (res.error) throw new Error(res.error.message);
  return res.data as NonNullable<T>;
}

/**
 * Per-file factory for users/groups that tracks what it created and tears it
 * all down in dispose(). Every actor holds its own authenticated client, signed
 * in with a real password — the service role creates the account and tears it
 * down, and does nothing on an actor's behalf in between.
 */
export class TestBed {
  readonly service: Client = newClient(resolveStack().serviceRoleKey);
  private users: TestUser[] = [];
  private groupIds: string[] = [];

  /**
   * Deliberately not signUp: that returns a session only while email
   * confirmation is off, which would tie the whole suite to the product's
   * email policy (PLA-71). Creating the account pre-confirmed and then signing
   * in works either way. What is under test is unaffected — the trigger on
   * auth.users fires the same on an admin insert, so the profile and handle
   * are built exactly as a real signup builds them.
   */
  async createUser(name?: string): Promise<TestUser> {
    const email = `it-${randomUUID()}@example.com`;
    const client = newClient(resolveStack().anonKey);
    const { data, error } = await this.service.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: name ? { display_name: name } : undefined,
    });
    if (error || !data.user) {
      throw new Error(
        `admin.createUser failed for ${email}: ${error?.message ?? 'no user returned'}`,
      );
    }
    const { data: signIn, error: signInError } = await client.auth.signInWithPassword({
      email,
      password: PASSWORD,
    });
    if (signInError || !signIn.session) {
      throw new Error(
        `sign-in failed for ${email}: ${signInError?.message ?? 'no session returned'}`,
      );
    }
    const user = { id: data.user.id, email, name: name ?? email.split('@')[0], client };
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
