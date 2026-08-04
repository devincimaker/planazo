import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import { PHOTO_SELECT, SIGNED_URL_TTL_SECONDS, signPhotos, type PhotoRow } from './photos';

export const planPhotosKey = (planId: string) => ['plan-photos', planId] as const;

/**
 * An album's rows, and their signed URLs.
 *
 * Both the plan-detail card and the album screen want exactly this, and when
 * each had its own copy the select string, the cache key and the staleTime
 * had to be kept in step by hand across two files. `realtime.ts` invalidates
 * the same key from a third place.
 *
 * Two queries rather than one because they answer at different speeds and the
 * UI uses that: the rows land first and carry the count, which is what lets a
 * grid reserve its exact shape before a single image has arrived.
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

  const signedQuery = useQuery({
    queryKey: [...planPhotosKey(planId), 'signed', rows?.length ?? 0, rows?.[0]?.id ?? null],
    enabled: enabled && !!rows?.length,
    // A signature outlives this comfortably. `refetchOnWindowFocus` is
    // 'always' app-wide (see app/_layout.tsx), which ignores staleTime by
    // design, so it is switched off here: re-signing on every foreground
    // hands every mounted Image a new URL and re-downloads the whole grid.
    staleTime: (SIGNED_URL_TTL_SECONDS * 1000) / 2,
    refetchOnWindowFocus: false,
    queryFn: () => signPhotos(rows ?? []),
  });

  return {
    rows,
    signed: signedQuery.data,
    isLoading: rowsQuery.isLoading,
    error: rowsQuery.error ?? signedQuery.error,
  };
}
