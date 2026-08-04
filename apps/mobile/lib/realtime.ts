import { useEffect } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useQueryClient, QueryKey } from '@tanstack/react-query';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { useAuthStore } from '../stores/authStore';

/**
 * Tables the cache-sync channel listens to, mirrored by the
 * supabase_realtime publication migration. RLS decides what actually gets
 * delivered: a subscriber only receives rows their own SELECT policies allow,
 * so one table-wide listener per table is safe.
 */
export const SUBSCRIBED_TABLES = [
  'rsvps',
  'date_availability',
  'plans',
  'group_members',
  'plan_photos',
  'plan_polls',
  'plan_poll_options',
  'plan_poll_votes',
] as const;

export type SubscribedTable = (typeof SUBSCRIBED_TABLES)[number];

/** How long one burst of events is allowed to pool before invalidating. */
export const FLUSH_DELAY_MS = 250;

/**
 * Which query caches a change to `table` makes stale. Invalidation only — the
 * RLS-filtered refetch is the source of truth, so getting this wrong costs a
 * refetch, never wrong data on screen.
 *
 * `record` is the event's `new` row, or `old` for deletes. Deleted rows carry
 * only their primary key (replica identity default), so an rsvp/availability
 * delete can't name its plan — those fall back to the bare key, which
 * invalidates every plan's copy as a prefix. Only mounted screens refetch, so
 * the fan-out is at most the one or two screens actually open.
 *
 * The bare ['group'] on rsvp/availability changes is deliberate too: those
 * rows don't carry a group_id, and the group screen embeds rsvps and
 * availability inside its ['group', id] query.
 */
export function keysForChange(
  table: SubscribedTable,
  record: Record<string, unknown>,
): QueryKey[] {
  const planId = typeof record.plan_id === 'string' ? record.plan_id : null;
  const groupId = typeof record.group_id === 'string' ? record.group_id : null;

  switch (table) {
    case 'rsvps':
      return [
        planId ? ['plan-rsvps', planId] : ['plan-rsvps'],
        ['home-plans'],
        ['group'],
        ['groups'],
      ];
    case 'date_availability':
      return [
        planId ? ['plan-availabilities', planId] : ['plan-availabilities'],
        ['home-plans'],
        ['group'],
        ['groups'],
      ];
    case 'plan_photos':
      // Somebody else's upload appearing under you while you are looking at
      // the album is the whole point of this table being here. A delete
      // carries only its id, so it falls back to the bare prefix.
      return [planId ? ['plan-photos', planId] : ['plan-photos']];
    case 'plan_polls':
    case 'plan_poll_options':
    case 'plan_poll_votes':
      // One case for all three: the detail screen reads the poll, its options
      // and its votes as a single nested ['plan-poll', id] query, and all
      // three tables denormalise plan_id so every insert/update names its
      // plan. Votes moving under you while you look at the tally is the most
      // valuable live update the poll has (PLA-47). home-plans re-renders the
      // feed card's open-question / answer line.
      return [planId ? ['plan-poll', planId] : ['plan-poll'], ['home-plans']];
    case 'plans': {
      // A plan's own id is its primary key, so even deletes can name it.
      const id = typeof record.id === 'string' ? record.id : null;
      return [
        id ? ['plan', id] : ['plan'],
        ['home-plans'],
        groupId ? ['group', groupId] : ['group'],
        ['groups'],
        ['cancel-notices'],
      ];
    }
    case 'group_members':
      return [
        groupId ? ['group', groupId] : ['group'],
        ['groups'],
        ['my-groups'],
        ['home-plans'],
        ['plan-membership'],
        groupId ? ['plan-group-member-ids', groupId] : ['plan-group-member-ids'],
      ];
  }
}

/**
 * One app-wide channel that turns other people's writes into cache
 * invalidations, so their RSVPs, votes, plan changes and invite-accepts land
 * on screen without a manual refresh (PLA-28).
 *
 * Lives only while the app is foregrounded and someone is signed in. A
 * suspended app must not hold sockets open, so backgrounding tears the channel
 * down; whatever happened while away is covered by PLA-15's
 * refetchOnWindowFocus: 'always' the moment the app returns. Token refreshes
 * reach the socket on their own — supabase-js forwards auth changes to
 * realtime.setAuth internally.
 */
export function useRealtimeCacheSync(): void {
  const userId = useAuthStore((state) => state.user?.id);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;

    let channel: RealtimeChannel | null = null;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const pending = new Map<string, QueryKey>();

    const flush = () => {
      flushTimer = null;
      const keys = [...pending.values()];
      pending.clear();
      for (const queryKey of keys) {
        void queryClient.invalidateQueries({ queryKey });
      }
    };

    // Pools a burst (sending four dates is four inserts, and the actor's own
    // onSuccess invalidation echoes back too) into one invalidation pass,
    // FLUSH_DELAY_MS after the first event rather than the last so a busy
    // group can't postpone the flush indefinitely.
    const queue = (keys: QueryKey[]) => {
      for (const key of keys) {
        pending.set(JSON.stringify(key), key);
      }
      flushTimer ??= setTimeout(flush, FLUSH_DELAY_MS);
    };

    const subscribe = () => {
      if (channel) return;
      const next = supabase.channel('cache-sync');
      for (const table of SUBSCRIBED_TABLES) {
        next.on(
          'postgres_changes',
          { event: '*', schema: 'public', table },
          (payload) => {
            const record = payload.eventType === 'DELETE' ? payload.old : payload.new;
            queue(keysForChange(table, record as Record<string, unknown>));
          },
        );
      }
      next.subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // supabase-js reconnects with backoff on its own; stale data in the
          // meantime is what focus refetch already handles.
          console.warn(`Realtime cache sync reported ${status}; retrying in the background.`);
        }
      });
      channel = next;
    };

    const teardown = () => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      // Anything still pooled is stale-marking the focus refetch repeats anyway.
      pending.clear();
      if (channel) {
        void supabase.removeChannel(channel);
        channel = null;
      }
    };

    if (AppState.currentState === 'active') {
      subscribe();
    }
    const subscription = AppState.addEventListener('change', (status: AppStateStatus) => {
      if (status === 'active') {
        subscribe();
      } else {
        teardown();
      }
    });

    return () => {
      subscription.remove();
      teardown();
    };
  }, [userId, queryClient]);
}
