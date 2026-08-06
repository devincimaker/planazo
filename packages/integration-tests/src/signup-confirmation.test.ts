// The confirmation flow signup now ends in (PLA-70): signUp sends a 6-digit
// code, verifyOtp turns that code into a session, and the app never shows a
// sign-in form in between.
//
// This is the one stretch of auth the suite can test honestly, because the
// local mail catcher lets it read what the user reads. Everything asserted here
// is a claim the UI depends on: that a wrong code and an expired code are
// indistinguishable (so one message covers both), that asking for a new code
// kills the old one (so the copy says "the newest email"), and that an
// unconfirmed sign-in answers `email_not_confirmed` (so login.tsx can route to
// the code step instead of printing it).
import { describe, it, expect, afterAll } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { mailCatcher, resolveStack } from './env';

const PASSWORD = 'Planazo123!';
const stack = resolveStack();
const mail = mailCatcher();

const client = (key: string): SupabaseClient =>
  createClient(stack.url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const anon = client(stack.anonKey);
const service = client(stack.serviceRoleKey);

const createdIds: string[] = [];

afterAll(async () => {
  await Promise.all(createdIds.map((id) => service.auth.admin.deleteUser(id)));
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function signUpFresh(displayName?: string) {
  const email = `it-confirm-${randomUUID()}@example.com`;
  const { data, error } = await anon.auth.signUp({
    email,
    password: PASSWORD,
    options: displayName ? { data: { display_name: displayName } } : undefined,
  });

  if (error) throw new Error(`signUp failed for ${email}: ${error.message}`);
  if (data.user) createdIds.push(data.user.id);

  expect(
    data.session,
    'signUp returned a session, so email confirmation is off. This suite is about the ' +
      'confirm flow: set auth.email.enable_confirmations = true in supabase/config.toml.',
  ).toBeNull();

  return email;
}

/** Every code sent to an address, newest first. */
async function codesFor(email: string): Promise<string[]> {
  const res = await fetch(`${mail}/api/v1/messages?limit=500`);
  const body = (await res.json()) as { messages: { ID: string; To: { Address: string }[] }[] };
  const mine = body.messages.filter((m) => m.To?.some((to) => to.Address === email));

  const codes: string[] = [];
  for (const message of mine) {
    const detail = (await (await fetch(`${mail}/api/v1/message/${message.ID}`)).json()) as {
      Text?: string;
    };
    const code = detail.Text?.match(/\b(\d{6})\b/)?.[1];
    if (code) codes.push(code);
  }
  return codes;
}

/** Waits for the mail catcher to hold more than `seen` codes for this address. */
async function waitForCode(email: string, seen = 0): Promise<string[]> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const codes = await codesFor(email);
    if (codes.length > seen) return codes;
    await sleep(200);
  }
  throw new Error(`No confirmation email past #${seen} arrived for ${email}.`);
}

describe.skipIf(!mail)('signup confirmation', () => {
  it('emails a 6-digit code that verifyOtp turns into a session', async () => {
    const email = await signUpFresh('Confirm IT');
    const [code] = await waitForCode(email);

    expect(code).toMatch(/^\d{6}$/);

    const { data, error } = await anon.auth.verifyOtp({ email, token: code, type: 'signup' });

    expect(error).toBeNull();
    expect(data.session).not.toBeNull();
    expect(data.session?.user.email).toBe(email);

    // The profile trigger fires on the auth.users insert, so the name typed at
    // signup is already on the row the app reads straight after verifying.
    const profile = await service
      .from('profiles')
      .select('display_name')
      .eq('id', data.session!.user.id)
      .single();
    expect(profile.data?.display_name).toBe('Confirm IT');
  });

  /**
   * The reason the app shows one message for both. GoTrue answers a wrong code
   * with the same `otp_expired` it uses for a genuinely expired one, so there
   * is nothing to tell them apart with and copy that claimed to would be lying.
   */
  it('answers a wrong code with otp_expired, the same as an expired one', async () => {
    const email = await signUpFresh();
    await waitForCode(email);

    const { data, error } = await anon.auth.verifyOtp({
      email,
      token: '000000',
      type: 'signup',
    });

    expect(data.session).toBeNull();
    expect(error?.code).toBe('otp_expired');
  });

  /**
   * The reason the copy says "the newest email". Someone who asks for a fresh
   * code and then types the one from the first email gets a failure they did
   * nothing to deserve, so the app has to warn them.
   */
  it('invalidates the previous code when a new one is sent', async () => {
    const email = await signUpFresh();
    const [first] = await waitForCode(email);

    // auth.email.max_frequency refuses a second email inside its window.
    await sleep(1500);
    const { error: resendError } = await anon.auth.resend({ type: 'signup', email });
    expect(resendError).toBeNull();

    const [second] = await waitForCode(email, 1);
    expect(second).not.toBe(first);

    const stale = await anon.auth.verifyOtp({ email, token: first, type: 'signup' });
    expect(stale.error?.code).toBe('otp_expired');

    const fresh = await anon.auth.verifyOtp({ email, token: second, type: 'signup' });
    expect(fresh.error).toBeNull();
    expect(fresh.data.session).not.toBeNull();
  });

  /**
   * The error login.tsx now routes on instead of printing. If this code ever
   * changes, the sign-in screen silently goes back to being a dead end.
   */
  it('refuses an unconfirmed sign-in with email_not_confirmed', async () => {
    const email = await signUpFresh();

    const { data, error } = await anon.auth.signInWithPassword({ email, password: PASSWORD });

    expect(data.session).toBeNull();
    expect(error?.code).toBe('email_not_confirmed');
  });

  /**
   * Someone who quits and starts signup again with the same address must not be
   * told their account already exists: it does, but it is theirs and
   * unconfirmed, and the app carries them to the code step from here.
   */
  it('lets an unconfirmed address sign up again without an error', async () => {
    const email = await signUpFresh();
    await waitForCode(email);
    await sleep(1500);

    const { data, error } = await anon.auth.signUp({ email, password: PASSWORD });

    expect(error).toBeNull();
    expect(data.session).toBeNull();
  });
});
