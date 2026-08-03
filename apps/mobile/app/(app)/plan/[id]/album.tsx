import { useMemo, useState } from 'react';
import { Alert, FlatList, Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ThemedText } from '../../../../components/ui/ThemedText';
import { planPhotosKey } from '../../../../components/PhotoAlbumCard';
import { supabase } from '../../../../lib/supabase';
import { deletePhoto, signPhotos, type PlanPhoto, type SignedPhoto } from '../../../../lib/photos';
import { spellCount } from '../../../../lib/words';
import { useAuthStore } from '../../../../stores/authStore';
import { colors, radii, spacing } from '../../../../theme/tokens';

/**
 * Every photo on a plan.
 *
 * The plan-detail card shows four and a count; this is where the count goes.
 * Three across rather than the card's four, because here the tiles are the
 * content rather than a preview of it.
 *
 * Tapping a tile fills the screen with that photo. This is the shallow end of
 * the two poles the spec put to the designer: no swiping between photos, no
 * pinch to zoom. It carries the two actions the spec says a viewer must have
 * whatever its depth, because a word list cannot read a photograph and
 * reporting is the whole moderation mechanism for images.
 */
const COLUMNS = 3;

interface PhotoRow extends PlanPhoto {
  uploader: { display_name: string } | null;
}

/** A row that has been signed, still carrying who took it. */
type ViewerPhoto = SignedPhoto & { uploader?: { display_name: string } | null };

export default function PlanAlbumScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [open, setOpen] = useState<ViewerPhoto | null>(null);

  const { data: rows, isLoading } = useQuery({
    queryKey: planPhotosKey(String(id)),
    queryFn: async (): Promise<PhotoRow[]> => {
      const { data, error } = await supabase
        .from('plan_photos')
        .select(
          'id, plan_id, uploaded_by, storage_path, width, height, created_at, uploader:profiles!plan_photos_uploaded_by_fkey(display_name)',
        )
        .eq('plan_id', String(id))
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as PhotoRow[];
    },
  });

  const { data: signed } = useQuery({
    queryKey: [...planPhotosKey(String(id)), 'signed', rows?.length ?? 0, rows?.[0]?.id ?? null],
    enabled: !!rows?.length,
    staleTime: 30 * 60 * 1000,
    queryFn: async () => (await signPhotos(rows ?? [])).photos,
  });

  const subtitle = useMemo(() => {
    const total = rows?.length ?? 0;
    if (!total) return '';
    const people = new Set((rows ?? []).map((r) => r.uploaded_by)).size;
    if (people === 1) {
      const name = rows?.[0]?.uploader?.display_name;
      return name ? `${total} photos from ${name}` : `${total} photos`;
    }
    return `${total} photos from ${spellCount(people)} people`;
  }, [rows]);

  // The rows arrive before the signatures do, so the grid can hold its shape
  // with placeholder tiles instead of reflowing when the images land. An
  // unsigned tile carries an empty url and is not tappable.
  //
  // `signPhotos` spreads the row it was given, so the uploader survives the
  // trip even though SignedPhoto does not promise it. Saying so here is what
  // lets the viewer name who took the photo without casting at every use.
  const tiles: ViewerPhoto[] = signed?.length
    ? (signed as ViewerPhoto[])
    : (rows ?? []).map((r) => ({ ...r, url: '' }));

  const remove = useMutation({
    mutationFn: async (photo: SignedPhoto) => deletePhoto(photo),
    onSuccess: () => {
      setOpen(null);
      queryClient.invalidateQueries({ queryKey: planPhotosKey(String(id)) });
    },
    onError: () =>
      Alert.alert('That did not work', 'The photo is still there. Try again in a moment.'),
  });

  const confirmRemove = (photo: SignedPhoto) =>
    Alert.alert('Remove this photo?', 'It goes for everyone.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => remove.mutate(photo) },
    ]);

  const mine = !!open && open.uploaded_by === user?.id;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" testID="album-back">
          <ThemedText variant="bodyStrong" color={colors.accent}>
            ‹ Back
          </ThemedText>
        </Pressable>
      </View>

      <View style={styles.title}>
        <ThemedText variant="headerTitle">Photos</ThemedText>
        {subtitle ? (
          <ThemedText variant="sub" color={colors.textSecondary}>
            {subtitle}
          </ThemedText>
        ) : null}
      </View>

      <FlatList
        data={tiles}
        keyExtractor={(item) => item.id}
        numColumns={COLUMNS}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.grid}
        ListEmptyComponent={
          isLoading ? null : (
            <ThemedText variant="body" color={colors.textMuted}>
              Nothing here yet.
            </ThemedText>
          )
        }
        renderItem={({ item, index }) => (
          <Pressable
            onPress={() => (item.url ? setOpen(item) : undefined)}
            disabled={!item.url}
            accessibilityRole="button"
            accessibilityLabel={`Photo ${index + 1}${
              item.uploader ? `, from ${item.uploader.display_name}` : ''
            }`}
            style={[
              styles.tile,
              { backgroundColor: index % 2 ? colors.photoPlaceholderAlt : colors.photoPlaceholder },
            ]}
            testID={`album-tile-${index}`}
          >
            {item.url ? (
              <Image source={{ uri: item.url }} style={styles.fill} resizeMode="cover" />
            ) : null}
          </Pressable>
        )}
      />

      {/* Tap anywhere on the backdrop to dismiss. The actions sit on the
          backdrop rather than over the photograph, so nothing a person is
          trying to look at is covered by a control. */}
      <Modal
        visible={!!open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(null)}
      >
        {/* The backdrop is a sibling underneath rather than a parent wrapping
            everything. As a parent it was a Pressable with children, which
            iOS merges into one accessible element: the photo's caption and
            the action fused into a single target whose centre is dead space,
            so Report could not be hit at all. */}
        <View style={styles.backdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setOpen(null)}
            accessibilityRole="button"
            accessibilityLabel="Close photo"
            testID="viewer-backdrop"
          />
          {open ? (
            <Image source={{ uri: open.url }} style={styles.full} resizeMode="contain" />
          ) : null}

          <View style={styles.viewerBar}>
            {open?.uploader?.display_name ? (
              <ThemedText variant="caption" color={colors.textOnAccent}>
                {mine ? 'Your photo' : `From ${open.uploader.display_name}`}
              </ThemedText>
            ) : (
              <View />
            )}

            <Pressable
              onPress={() => {
                if (!open) return;
                if (mine) {
                  confirmRemove(open);
                  return;
                }
                setOpen(null);
                router.push({
                  pathname: '/(app)/report',
                  params: {
                    type: 'photo',
                    id: open.id,
                    subject: 'a photo',
                    personId: open.uploaded_by,
                    personName: open.uploader?.display_name ?? '',
                  },
                });
              }}
              accessibilityRole="button"
              hitSlop={12}
              testID="viewer-action"
            >
              <ThemedText variant="bodyStrong" color={colors.textOnAccent}>
                {mine ? 'Remove' : 'Report photo'}
              </ThemedText>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  title: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
    gap: spacing.xxs,
  },
  grid: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxxl,
    gap: spacing.xs,
  },
  row: {
    gap: spacing.xs,
  },
  tile: {
    flex: 1 / COLUMNS,
    aspectRatio: 1,
    borderRadius: radii.photoTile,
    overflow: 'hidden',
  },
  fill: {
    width: '100%',
    height: '100%',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(23,18,21,0.94)',
    justifyContent: 'center',
  },
  full: {
    width: '100%',
    height: '78%',
  },
  viewerBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
});
