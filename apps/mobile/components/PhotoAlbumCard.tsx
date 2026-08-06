import { useCallback, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ThemedText } from './ui/ThemedText';
import { Button } from './ui/Button';
import { PhotoTile } from './ui/PhotoTile';
import { usePlanAlbumCard, planPhotosKey } from '../lib/usePlanPhotos';
import {
  MAX_PHOTOS_PER_PERSON,
  MAX_PHOTOS_PER_PLAN,
  albumSummary,
  pickPhotos,
  uploadPhotos,
  type UploadOutcome,
} from '../lib/photos';
import { errorCopy } from '../lib/queryErrors';
import { colors, radii, spacing } from '../theme/tokens';

/** Tiles the strip shows before it stops and lets the count do the talking.
 *  `plan_album_card` returns exactly this many, so changing one means
 *  changing the other. */
const STRIP_MAX = 4;

interface Props {
  planId: string;
  userId: string;
  /** The night has started. Before that there is no album at all. */
  albumOpen: boolean;
  /** Was in the plan, so may add to it. Everyone else looks. */
  canAdd: boolean;
}

export function PhotoAlbumCard({ planId, userId, albumOpen, canAdd }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [batch, setBatch] = useState<UploadOutcome | null>(null);

  const { summary, signed, error } = usePlanAlbumCard(planId, { enabled: albumOpen });

  const total = summary?.total ?? 0;
  const mine = summary?.mine ?? 0;

  const upload = useMutation({
    mutationFn: async () => {
      // Ask for no more than the database will accept, so the picker never
      // offers thirty when there is room for six.
      const room = Math.min(MAX_PHOTOS_PER_PERSON - mine, MAX_PHOTOS_PER_PLAN - total);
      const picked = await pickPhotos(Math.max(room, 0));
      if (!picked.length) return null;

      setProgress({ done: 0, total: picked.length });
      return uploadPhotos({
        planId,
        userId,
        photos: picked,
        onProgress: (done, of) => setProgress({ done, total: of }),
      });
    },
    onSuccess: (result) => {
      setProgress(null);
      if (result) setBatch(result);
      queryClient.invalidateQueries({ queryKey: planPhotosKey(planId) });
    },
    onError: () => setProgress(null),
  });

  const openAlbum = useCallback(() => router.push(`/plan/${planId}/album`), [router, planId]);

  const planFull = total >= MAX_PHOTOS_PER_PLAN;
  const youFull = mine >= MAX_PHOTOS_PER_PERSON;

  // An empty album you are not allowed to fill is a locked door. It appears
  // for a bystander only once somebody has actually put something in it.
  if (!albumOpen) return null;
  if (!total && !canAdd && !error) return null;

  const strip = (signed ?? []).slice(0, STRIP_MAX);
  const uploading = !!progress;

  // A failed read is not an empty album. Saying "nothing here yet" when the
  // query never answered tells someone their night was not recorded.
  if (error) {
    return (
      <View style={styles.section}>
        <ThemedText variant="sectionLabel">Photos</ThemedText>
        <View style={styles.card}>
          <View style={styles.summary}>
            <ThemedText variant="body" color={colors.textSecondary}>
              {errorCopy(error).title}
            </ThemedText>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <ThemedText variant="sectionLabel">Photos</ThemedText>

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
            <View style={styles.hero}>
              {signed?.[0] ? (
                <Image source={{ uri: signed[0].url }} style={styles.fill} resizeMode="cover" />
              ) : null}
            </View>
          </View>
        ) : (
          <View style={[styles.pad, styles.strip]}>
            {strip.length
              ? strip.map((photo, index) => (
                  <PhotoTile key={photo.id} url={photo.thumbUrl} index={index} />
                ))
              : Array.from({ length: Math.min(total, STRIP_MAX) }, (_, index) => (
                  <PhotoTile key={index} index={index} />
                ))}
          </View>
        )}

        {/* ------------------------------------------------------- summary */}
        {total > 0 || uploading || batch ? (
          <View style={styles.summary}>
            <ThemedText variant="body" style={styles.summaryText}>
              {progress
                ? `Adding ${progress.done} of ${progress.total}`
                : batch?.refused
                  ? "You weren't in this plan, so you can't add to its album."
                  : batch?.failed
                    ? `${batch.added} added. ${batch.failed} didn't upload.`
                    : albumSummary(summary ?? { total: 0, uploaders: 0 })}
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
              // A refusal is the one outcome retrying cannot change (PLA-55).
              // The button stays visible so the card does not rearrange itself
              // under the person's thumb, but it stops inviting the tap.
              disabled={uploading || planFull || youFull || !!batch?.refused}
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

function actionLabel({
  batch,
  planFull,
  youFull,
  uploading,
}: {
  batch: UploadOutcome | null;
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
  fill: {
    width: '100%',
    height: '100%',
  },
  strip: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.md,
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
