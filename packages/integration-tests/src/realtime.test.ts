// The mobile app's cache-sync channel (PLA-28) only receives events for tables
// in the supabase_realtime publication. Nothing else in the stack notices when
// a table is missing from it — subscriptions just go silent — so the
// publication's contents are pinned here. Deliberately no live websocket
// round-trip: it would hang against a local stack whose realtime container
// predates config.toml enabling it, and delivery mechanics are Supabase's to
// test, not ours.
import { describe, it, expect } from 'vitest';
import { Client } from 'pg';
import { resolveStack } from './env';

describe('supabase_realtime publication', () => {
  it('publishes every table the cache-sync channel listens to', async () => {
    // Mirrors apps/mobile/lib/realtime.ts SUBSCRIBED_TABLES.
    const expected = ['rsvps', 'date_availability', 'plans', 'group_members'];

    const client = new Client({
      connectionString: resolveStack().dbUrl!,
      connectionTimeoutMillis: 10_000,
    });
    await client.connect();
    try {
      const res = await client.query(
        `select tablename from pg_publication_tables
         where pubname = 'supabase_realtime' and schemaname = 'public'`,
      );
      const published = res.rows.map((r: { tablename: string }) => r.tablename);
      for (const table of expected) {
        expect(published).toContain(table);
      }
    } finally {
      await client.end().catch(() => {});
    }
  });
});
