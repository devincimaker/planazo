import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@planazo/shared';
import { randomUUID } from 'node:crypto';
import { localStack } from './env';

export type Client = SupabaseClient<Database>;

export interface TestUser {
  id: string;
  email: string;
  name: string;
  client: Client;
}

const PASSWORD = 'Planazo123!';

function newClient(key: string): Client {
  const { url } = localStack();
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
 * all down in dispose(). Every actor is a real signed-up user holding its own
 * authenticated client — the service role is for setup/teardown only.
 */
export class TestBed {
  readonly service: Client = newClient(localStack().serviceRoleKey);
  private users: TestUser[] = [];
  private groupIds: string[] = [];

  async createUser(name?: string): Promise<TestUser> {
    const email = `it-${randomUUID()}@example.com`;
    const client = newClient(localStack().anonKey);
    const { data, error } = await client.auth.signUp({
      email,
      password: PASSWORD,
      options: name ? { data: { display_name: name } } : undefined,
    });
    if (error || !data.user || !data.session) {
      throw new Error(
        `signUp failed for ${email}: ${error?.message ?? 'no session (are confirmations enabled?)'}`,
      );
    }
    const user = { id: data.user.id, email, name: name ?? email.split('@')[0], client };
    this.users.push(user);
    return user;
  }

  /** Creates a group the way the app does: owner inserts the row, then their own admin membership. */
  async createGroup(owner: TestUser, opts: { name?: string; anyone_can_post?: boolean } = {}) {
    const group = ok(
      await owner.client
        .from('groups')
        .insert({
          name: opts.name ?? `it-group-${randomUUID().slice(0, 8)}`,
          invite_code: inviteCode(),
          created_by: owner.id,
          anyone_can_post: opts.anyone_can_post ?? true,
        })
        .select()
        .single(),
    );
    this.groupIds.push(group.id);
    ok(
      await owner.client
        .from('group_members')
        .insert({ group_id: group.id, user_id: owner.id, role: 'admin' }),
    );
    return group;
  }

  /** Joins via direct membership insert — the invite-code path the app uses after get_group_by_invite_code. */
  async join(groupId: string, user: TestUser, role: 'admin' | 'member' = 'member') {
    ok(
      await user.client
        .from('group_members')
        .insert({ group_id: groupId, user_id: user.id, role }),
    );
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

function inviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

/** ISO timestamp `days` from now (positive = future). */
export function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}
