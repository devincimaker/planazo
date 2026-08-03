-- PLA-28: the mobile app subscribes to postgres_changes on these four tables
-- and invalidates react-query caches, so other people's RSVPs, votes, plan
-- changes and invite-accepts show up without a manual refresh.
--
-- Realtime only delivers tables that are in the supabase_realtime publication.
-- Hosted projects ship with the publication; a stack that has run with
-- realtime disabled may not have it, so create it defensively first.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

-- No REPLICA IDENTITY FULL: the app never filters server-side, and DELETE
-- events (which then carry only the old primary key) trigger a coarse,
-- prefix-wide invalidation on the client instead.
ALTER PUBLICATION supabase_realtime ADD TABLE
  public.rsvps,
  public.date_availability,
  public.plans,
  public.group_members;
