// send-push — delivers one notification row as an Expo push.
//
// Called by the trg_push_notification pg_net trigger with {id}. Runs with
// verify_jwt off (the trigger can't sign a JWT); authenticates via the
// x-push-secret header, which must match the PUSH_TRIGGER_SECRET function
// secret (same value lives in Vault as send_push_secret for the trigger).
//
// Idempotent: the row is claimed by stamping pushed_at before sending, so a
// duplicate invocation for the same id is a no-op. Rows are only ever read
// back from the database — callers can't inject content.

import { createClient } from 'npm:@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('PUSH_TRIGGER_SECRET');
  if (!secret || req.headers.get('x-push-secret') !== secret) {
    return json({ error: 'unauthorized' }, 401);
  }

  let id: unknown;
  try {
    ({ id } = await req.json());
  } catch {
    return json({ error: 'invalid body' }, 400);
  }
  if (typeof id !== 'string') {
    return json({ error: 'missing id' }, 400);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // Claim first: only one invocation can flip pushed_at from NULL.
  const { data: row, error: claimError } = await supabase
    .from('notifications')
    .update({ pushed_at: new Date().toISOString() })
    .eq('id', id)
    .is('pushed_at', null)
    .select('user_id, title, body, data')
    .maybeSingle();
  if (claimError) {
    return json({ error: claimError.message }, 500);
  }
  if (!row) {
    return json({ skipped: 'already handled' });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('push_token, push_enabled')
    .eq('id', row.user_id)
    .maybeSingle();
  if (!profile?.push_token || !profile.push_enabled) {
    return json({ skipped: 'no token or pushes off' });
  }

  const res = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      to: profile.push_token,
      title: row.title,
      body: row.body,
      data: row.data ?? {},
      sound: 'default',
    }),
  });
  const result = await res.json().catch(() => null);
  const ticket = result?.data;

  // Expo tells us when a token is dead (app uninstalled) — drop it so we
  // stop sending to it.
  if (ticket?.details?.error === 'DeviceNotRegistered') {
    await supabase
      .from('profiles')
      .update({ push_token: null })
      .eq('id', row.user_id);
    return json({ skipped: 'device not registered' });
  }
  if (!res.ok || ticket?.status === 'error') {
    return json({ error: ticket?.message ?? `expo returned ${res.status}` }, 502);
  }

  return json({ sent: true });
});
