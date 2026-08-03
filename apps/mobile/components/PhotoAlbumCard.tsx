import { useCallback, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ThemedText } from './ui/ThemedText';
import { Button } from './ui/Button';
import { supabase } from '../lib/supabase';
import {
  MAX_PHOTOS_PER_PERSON,
  MAX_PHOTOS_PER_PLAN,
  pickPhotos,
  signPhotos,
  uploadPhotos,
  type PlanPhoto,
  type SignedPhoto,
} from '../lib/photos';
import { spellCount } from '../lib/words';
import { colors, radii, spacing, type } from '../theme/tokens';

/** Tiles the strip shows before it stops and lets the count do the talking. */
const STRIP_MAX = 4;

export const planPhotosKey = (planId: string) => ['plan-photos', planId] as const;

interface PhotoRow extends PlanPhoto {
  uploader: { display_name: string } | null;
}

interface Props {
  planId: string;
  userId: string;
  /** The night has started. Before that there is no album at all. */
  albumOpen: boolean;
  /** Said yes, or hosts it. Everyone else looks without adding. */
  canAdd: boolean;
}

interface BatchResult {
  added: number;
  failed: number;
  capReached: boolean;
}

export function PhotoAlbumCard({ planId, userId, albumOpen, canAdd }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [batch, setBatch] = useState<BatchResult | null>(null);

  const { data: rows, isLoading } = useQuery({
    queryKey: planPhotosKey(planId),
    enabled: albumOpen,
    queryFn: async (): Promise<PhotoRow[]> => {
      const { data, error } = await supabase
        .from('plan_photos')
        .select(
          'id, plan_id, uploaded_by, storage_path, width, height, created_at, uploader:profiles!plan_photos_uploaded_by_fkey(display_name)',
        )
        .eq('plan_id', planId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as PhotoRow[];
    },
  });

  // Signing is a second request that cannot start until the rows land, which
  // is why the count is known before any image is. The strip below uses that
  // to reserve its exact shape rather than popping into place.
  const { data: signed } = useQuery({
    queryKey: [...planPhotosKey(planId), 'signed', rows?.length ?? 0, rows?.[0]?.id ?? null],
    enabled: !!rows?.length,
    // A signature outlives this comfortably; refetching on focus covers the
    // phone that sat on this screen through lunch.
    staleTime: 30 * 60 * 1000,
    queryFn: async () => (await signPhotos(rows ?? [])).photos,
  });

  const total = rows?.length ?? 0;
  const mine = useMemo(
    () => (rows ?? []).filter((r) => r.uploaded_by === userId).length,
    [rows, userId],
  );
  const uploaders = useMemo(
    () => new Set((rows ?? []).map((r) => r.uploaded_by)).size,
    [rows],
  );

  const upload = useMutation({
    mutationFn: async () => {
      // Ask for no more than the database will accept, so the picker never
      // offers thirty when there is room for six.
      const room = Math.min(
        MAX_PHOTOS_PER_PERSON - mine,
        MAX_PHOTOS_PER_PLAN - total,
      );
      const picked = await pickPhotos(Math.max(room, 0));
      if (!picked.length) return null;

      setProgress({ done: 0, total: picked.length });
      return uploadPhotos(planId, userId, picked, (done, total) =>
        setProgress({ done, total }),
      );
    },
    onSuccess: (result) => {
      setProgress(null);
      if (result) setBatch(result);
      queryClient.invalidateQueries({ queryKey: planPhotosKey(planId) });
    },
    onError: () => setProgress(null),
  });

  const openAlbum = useCallback(
    () => router.push(`/plan/${planId}/album`),
    [router, planId],
  );

  const planFull = total >= MAX_PHOTOS_PER_PLAN;
  const youFull = mine >= MAX_PHOTOS_PER_PERSON;

  // An empty album you are not allowed to fill is a locked door. It appears
  // for a bystander only once somebody has actually put something in it.
  if (!albumOpen) return null;
  if (!total && !canAdd) return null;

  const strip = (signed ?? []).slice(0, STRIP_MAX);
  const uploading = !!progress;

  return (
    <View style={styles.section}>
      <ThemedText variant="sectionLabel" color={colors.textMuted}>
        Photos
      </ThemedText>

      <Pressable
        onPress={total ? openAlbum : undefined}
        disabled={!total}
        accessibilityRole={total ? 'button' : undefined}
        accessibilityLabel={
          total ? `Open the album, ${total} ${total === 1 ? 'photo' : 'photos'}` : undefined
        }
        style={styles.card}
        testID="photo-album-card"
      >
        {/* ---------------------------------------------------------- body */}
        {total === 0 ? (
          <View style={styles.pad}>
            <View style={styles.empty}>
              <ThemedText variant="body" color={colors.textSecondary}>
                Nothing here yet.
              </ThemedText>
              <ThemedText variant="caption" color={colors.textMuted}>
                The first photo of the night goes here
              </ThemedText>
            </View>
          </View>
        ) : total === 1 && !uploading ? (
          <View style={styles.pad}>
            <Hero photo={signed?.[0]} />
          </View>
        ) : (
          <View style={[styles.pad, styles.strip]}>
            {(strip.length ? strip : placeholders(Math.min(total, STRIP_MAX))).map(
              (photo, index) => (
                <Tile key={typeof photo === 'string' ? photo : photo.id} photo={photo} index={index} />
              ),
            )}
          </View>
        )}

        {/* ------------------------------------------------------- summary */}
        {total > 0 || uploading || batch ? (
          <View style={styles.summary}>
            <ThemedText variant="body" style={styles.summaryText}>
              {summaryLine({ total, uploaders, progress, batch, rows: rows ?? [] })}
            </ThemedText>
            {total > 1 && !uploading ? (
              <ThemedText variant="body" color={colors.textFaint}>
                ›
              </ThemedText>
            ) : null}
          </View>
        ) : null}

        {/* -------------------------------------------------------- action */}
        {canAdd ? (
          <View style={styles.action}>
            <Button
              label={actionLabel({ batch, planFull, youFull, uploading })}
              variant="accentOutline"
              onPress={() => upload.mutate()}
              disabled={uploading || planFull || youFull}
              style={styles.button}
              testID="add-photos"
            />
          </View>
        ) : null}
      </Pressable>

      {/* The two ceilings say different things. Yours is a fact about you and
          the album still has room; the album's is about everyone. */}
      {youFull && !planFull ? (
        <ThemedText variant="caption" color={colors.textMuted}>
          You've added your {MAX_PHOTOS_PER_PERSON} photos to this plan.
        </ThemedText>
      ) : null}
    </View>
  );
}

/** Placeholder keys for tiles whose signature has not arrived yet. */
function placeholders(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `pending-${i}`);
}

function Hero({ photo }: { photo?: SignedPhoto }) {
  return (
    <View style={styles.hero}>
      {photo ? <Image source={{ uri: photo.url }} style={styles.fill} resizeMode="cover" /> : null}
    </View>
  );
}

function Tile({ photo, index }: { photo: SignedPhoto | string; index: number }) {
  const pending = typeof photo === 'string';
  return (
    <View
      style={[
        styles.tile,
        // Alternating fills so a row of tiles still waiting reads as a row
        // rather than one flat block.
        { backgroundColor: index % 2 ? colors.photoPlaceholderAlt : colors.photoPlaceholder },
      ]}
    >
      {pending ? null : <Image source={{ uri: photo.url }} style={styles.fill} resizeMode="cover" />}
    </View>
  );
}

function summaryLine({
  total,
  uploaders,
  progress,
  batch,
  rows,
}: {
  total: number;
  uploaders: number;
  progress: { done: number; total: number } | null;
  batch: BatchResult | null;
  rows: PhotoRow[];
}): string {
  if (progress) return `Adding ${progress.done} of ${progress.total}`;
  if (batch?.failed) {
    return `${batch.added} added. ${batch.failed} didn't upload.`;
  }
  if (total === 1) {
    const name = rows[0]?.uploader?.display_name;
    return name ? `One photo, from ${name}` : 'One photo';
  }
  if (uploaders === 1) {
    const name = rows[0]?.uploader?.display_name;
    return name ? `${total} photos from ${name}` : `${total} photos`;
  }
  return `${total} photos from ${spellCount(uploaders)} people`;
}

function actionLabel({
  batch,
  planFull,
  youFull,
  uploading,
}: {
  batch: BatchResult | null;
  planFull: boolean;
  youFull: boolean;
  uploading: boolean;
}): string {
  if (uploading) return 'Adding photos';
  if (planFull) return 'This album is full';
  if (youFull) return 'You have added your share';
  if (batch?.failed) {
    return batch.failed === 1 ? 'Try the other one again' : `Try the other ${batch.failed} again`;
  }
  return 'Add photos';
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    overflow: 'hidden',
  },
  // The card insets its contents by 4 on every side, which is what makes the
  // photo's 20 sit concentrically inside the card's 24.
  pad: {
    padding: spacing.xs,
  },
  empty: {
    aspectRatio: 4 / 3,
    borderRadius: radii.photo,
    backgroundColor: colors.surfaceSunken,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  hero: {
    aspectRatio: 4 / 3,
    borderRadius: radii.photo,
    backgroundColor: colors.photoPlaceholder,
    overflow: 'hidden',
  },
  strip: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  tile: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: radii.photoTile,
    overflow: 'hidden',
  },
  fill: {
    width: '100%',
    height: '100%',
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  summaryText: {
    flexShrink: 1,
  },
  action: {
    padding: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  button: {
    width: '100%',
  },
});
