import { useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
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
 * Tapping a tile fills the screen with that photo, and the viewer pages
 * between all of them. Still short of the deep pole the spec described: no
 * pinch to zoom, no drag-down-to-dismiss that tracks your finger.
 *
 * It carries the two actions the spec says a viewer must have whatever its
 * depth, because a word list cannot read a photograph and reporting is the
 * whole moderation mechanism for images.
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
  // Which photo the viewer is on, as an index into `viewable` rather than the
  // photo itself, because swiping moves it and the caption has to follow.
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const { width } = useWindowDimensions();

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

  // Only signed photos are swipeable: an unsigned tile has nothing to show, so
  // letting the viewer land on one would be a blank page between two photos.
  const viewable = tiles.filter((t) => t.url);
  const current = openIndex === null ? null : viewable[openIndex] ?? null;
  const close = () => setOpenIndex(null);

  const remove = useMutation({
    mutationFn: async (photo: SignedPhoto) => deletePhoto(photo),
    onSuccess: () => {
      close();
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

  const mine = !!current && current.uploaded_by === user?.id;

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
            onPress={() => {
              if (!item.url) return;
              const at = viewable.findIndex((v) => v.id === item.id);
              if (at >= 0) setOpenIndex(at);
            }}
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

      <Modal
        visible={openIndex !== null}
        transparent
        animationType="fade"
        onRequestClose={close}
      >
        <View style={styles.backdrop}>
          {/* One full-width page per photo, so a swipe moves between them and
              a tap anywhere on the page dismisses.

              The photo itself takes pointerEvents="none". An Image is a view
              like any other: it occupies its whole box and swallows taps even
              where `contain` has left the box transparent, so a portrait photo
              on a tall screen used to leave only a thin strip at each end that
              would actually close the viewer. Passing touches through is what
              makes "tap outside the photo" mean what it says. */}
          <FlatList
            data={viewable}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            keyExtractor={(item) => item.id}
            // contentOffset rather than initialScrollIndex: the latter scrolls
            // programmatically after mount, which fires onMomentumScrollEnd and
            // lands the index one page off whatever was tapped.
            contentOffset={{ x: (openIndex ?? 0) * width, y: 0 }}
            getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
            onMomentumScrollEnd={(event) =>
              setOpenIndex(Math.round(event.nativeEvent.contentOffset.x / width))
            }
            renderItem={({ item }) => (
              // Not accessible: every page carried the same "Close photo"
              // label, so a screen reader met the dismiss button once per
              // photo. The bar below has one, which is also easier to find
              // than the knowledge that tapping the picture works.
              <Pressable
                style={[styles.page, { width }]}
                onPress={close}
                accessible={false}
                importantForAccessibility="no-hide-descendants"
                testID="viewer-page"
              >
                <View pointerEvents="none" style={styles.imageWrap}>
                  <Image source={{ uri: item.url }} style={styles.full} resizeMode="contain" />
                </View>
              </Pressable>
            )}
          />

          {/* The bar sits over the backdrop rather than over the photograph,
              so nothing a person is trying to look at is under a control. */}
          <View style={styles.viewerBar}>
            <Pressable
              onPress={close}
              accessibilityRole="button"
              accessibilityLabel="Close photo"
              hitSlop={12}
              testID="viewer-close"
            >
              <ThemedText variant="bodyStrong" color={colors.textOnAccent}>
                Close
              </ThemedText>
            </Pressable>

            <View style={styles.viewerWho}>
              {current?.uploader?.display_name ? (
                <ThemedText variant="caption" color={colors.textOnAccent}>
                  {mine ? 'Your photo' : `From ${current.uploader.display_name}`}
                </ThemedText>
              ) : null}
              {viewable.length > 1 && openIndex !== null ? (
                <ThemedText variant="caption" color={colors.textFaint}>
                  {openIndex + 1} of {viewable.length}
                </ThemedText>
              ) : null}
            </View>

            <Pressable
              onPress={() => {
                if (!current) return;
                if (mine) {
                  confirmRemove(current);
                  return;
                }
                close();
                router.push({
                  pathname: '/(app)/report',
                  params: {
                    type: 'photo',
                    id: current.id,
                    subject: 'a photo',
                    personId: current.uploaded_by,
                    personName: current.uploader?.display_name ?? '',
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
  // A page in a horizontal list takes its width from the prop and its height
  // from the list. `flex: 1` here is what a vertical list would want, and in a
  // row it fights the explicit width until every page stacks at the same
  // offset and nothing pages at all.
  page: {
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageWrap: {
    width: '100%',
    alignItems: 'center',
  },
  full: {
    width: '100%',
    height: '78%',
  },
  viewerWho: {
    flexShrink: 1,
    gap: 1,
    alignItems: 'center',
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
