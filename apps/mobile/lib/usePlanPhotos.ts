import { useQuery, type QueryKey } from '@tanstack/react-query';
import { supabase } from './supabase';
import { PHOTO_SELECT, SIGNED_URL_REFRESH_MS, signPhotos, type PhotoRow } from './photos';

export const planPhotosKey = (planId: string) => ['plan-photos', planId] as const;

/**
 * The signed half of both album queries, dependent on rows the caller has
 * already fetched.
 *
 * One hook because the contract is the point, not the plumbing: staleTime is
 * pinned to the path cache's refresh threshold in photos.ts (the query can
 * only ever serve fresher than the cache re-signs), and `refetchOnWindowFocus`
 * is switched off against the app-wide 'always' (see app/_layout.tsx), which
 * ignores staleTime by design — re-signing on every foreground would hand
 * every mounted Image a new URL and re-download the grid.
 */
function useSignedPhotos<T extends { storage_path: string; thumb_path: string | null }>(
  queryKey: QueryKey,
  photos: T[] | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey,
    enabled: enabled && !!photos?.length,
    staleTime: SIGNED_URL_REFRESH_MS,
    refetchOnWindowFocus: false,
    queryFn: () => signPhotos(photos ?? []),
  });
}

/**
 * An album's rows, and their signed URLs. The album screen's query; the
 * plan-detail card uses {@link usePlanAlbumCard}, which never fetches past
 * the four photos it shows.
 *
 * Two queries rather than one because they answer at different speeds and the
 * UI uses that: the rows land first and carry the count, which is what lets a
 * grid reserve its exact shape before a single image has arrived.
 *
 * Every key in this file starts with `planPhotosKey(planId)`. That prefix is
 * the invalidation contract: `realtime.ts` and the card's upload mutation
 * both invalidate it, and anything keyed under it refetches.
 */
export function usePlanPhotos(planId: string, opts: { enabled?: boolean } = {}) {
  const enabled = opts.enabled ?? true;

  const rowsQuery = useQuery({
    queryKey: planPhotosKey(planId),
    enabled,
    queryFn: async (): Promise<PhotoRow[]> => {
      const { data, error } = await supabase
        .from('plan_photos')
        .select(PHOTO_SELECT)
        .eq('plan_id', planId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as PhotoRow[];
    },
  });

  const rows = rowsQuery.data;

  const signedQuery = useSignedPhotos(
    [...planPhotosKey(planId), 'signed', rows?.length ?? 0, rows?.[0]?.id ?? null],
    rows,
    enabled,
  );

  return {
    rows,
    signed: signedQuery.data,
    isLoading: rowsQuery.isLoading,
    error: rowsQuery.error ?? signedQuery.error,
  };
}

/** One of the newest four, as `plan_album_card` returns it. The shape is the
 *  other half of the `jsonb_build_object` in
 *  supabase/migrations/20260804000001_plan_album_card.sql — a drifted key
 *  surfaces as photos missing from the strip, not as a type error. */
export interface AlbumCardPhoto {
  id: string;
  storage_path: string;
  thumb_path: string | null;
  uploader_name: string | null;
}

export interface AlbumCardSummary {
  total: number;
  /** The caller's own count, decided by auth.uid() server-side. */
  mine: number;
  uploaders: number;
  /** Whoever uploaded the newest photo; what the album sentence leads with.
   *  Read off recent[0] so the sentence and the strip agree by construction. */
  name: string | null;
  /** Newest first, at most four. */
  recent: AlbumCardPhoto[];
}

/**
 * What the plan-detail card shows, and nothing more (PLA-56).
 *
 * The card used to mount the full album: every row, a profiles join per row,
 * and a signature per path, to draw four tiles and one sentence. At the
 * 200-photo cap that was ~135KB and two heavy round trips on every open of
 * any past plan. `plan_album_card` answers with three counts and the newest
 * four paths with their uploaders' names; only those four get signed.
 */
export function usePlanAlbumCard(planId: string, opts: { enabled?: boolean } = {}) {
  const enabled = opts.enabled ?? true;

  const summaryQuery = useQuery({
    queryKey: [...planPhotosKey(planId), 'card'],
    enabled,
    queryFn: async (): Promise<AlbumCardSummary> => {
      const { data, error } = await supabase.rpc('plan_album_card', { p_plan_id: planId });
      if (error) throw error;
      // Aggregates always produce exactly one row; [0] is unwrapping, not
      // guessing.
      const row = data[0];
      const recent = (row?.recent ?? []) as unknown as AlbumCardPhoto[];
      return {
        total: row?.total ?? 0,
        mine: row?.mine ?? 0,
        uploaders: row?.uploaders ?? 0,
        name: recent[0]?.uploader_name ?? null,
        recent,
      };
    },
  });

  const recent = summaryQuery.data?.recent;

  const signedQuery = useSignedPhotos(
    // Keyed by the ids rather than the count, so replacing the newest photo
    // re-signs even when the total is unchanged.
    [...planPhotosKey(planId), 'card-signed', (recent ?? []).map((p) => p.id)],
    recent,
    enabled,
  );

  return {
    summary: summaryQuery.data,
    signed: signedQuery.data,
    isLoading: summaryQuery.isLoading,
    error: summaryQuery.error ?? signedQuery.error,
  };
}
