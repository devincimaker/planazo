import { useCallback, useState } from 'react';
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
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ThemedText } from '../../../../components/ui/ThemedText';
import { PhotoTile } from '../../../../components/ui/PhotoTile';
import { ErrorState } from '../../../../components/ui/ErrorState';
import { usePlanPhotos, planPhotosKey } from '../../../../lib/usePlanPhotos';
import {
  albumSummary,
  deletePhoto,
  type PhotoRow,
  type SignedPhoto,
} from '../../../../lib/photos';
import { errorCopy } from '../../../../lib/queryErrors';
import { useAuthStore } from '../../../../stores/authStore';
import { colors, spacing } from '../../../../theme/tokens';

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

export default function PlanAlbumScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const planId = String(id);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  // Which photo the viewer is on, as an index rather than the photo itself,
  // because swiping moves it and the caption has to follow.
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const { width } = useWindowDimensions();

  const { rows, signed, isLoading, error } = usePlanPhotos(planId);

  // Signed photos are the only ones with anything to show, so they are both
  // what the pager pages over and what a tile can open.
  const viewable = signed ?? [];
  const current = openIndex === null ? null : (viewable[openIndex] ?? null);
  const close = useCallback(() => setOpenIndex(null), []);

  // Before the signatures land the grid still knows how many tiles to hold,
  // which is what stops it reflowing when the images arrive.
  const tiles: (SignedPhoto | PhotoRow)[] = viewable.length ? viewable : (rows ?? []);

  const remove = useMutation({
    mutationFn: (photo: SignedPhoto) => deletePhoto(photo),
    onSuccess: () => {
      close();
      queryClient.invalidateQueries({ queryKey: planPhotosKey(planId) });
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
        {rows?.length ? (
          <ThemedText variant="sub" color={colors.textSecondary}>
            {albumSummary(rows)}
          </ThemedText>
        ) : null}
      </View>

      {error ? (
        <ErrorState {...errorCopy(error)} />
      ) : (
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
              onPress={() => ('url' in item ? setOpenIndex(index) : undefined)}
              disabled={!('url' in item)}
              accessibilityRole="button"
              accessibilityLabel={`Photo ${index + 1}${
                item.uploader ? `, from ${item.uploader.display_name}` : ''
              }`}
              style={styles.cell}
              testID={`album-tile-${index}`}
            >
              <PhotoTile url={'url' in item ? item.thumbUrl : undefined} index={index} />
            </Pressable>
          )}
        />
      )}

      <Modal visible={openIndex !== null} transparent animationType="fade" onRequestClose={close}>
        <View style={styles.backdrop}>
          {/* Mounted only while the viewer is open, and this is load-bearing.
              A Modal keeps its children mounted when hidden, so a pager left
              behind sat at offset 0 and said so: the index snapped to the
              first photo, which opened the viewer on entering the screen and
              reopened it every time you dismissed it. Unmounting also means
              `contentOffset` is read fresh on each open, which is what lands
              it on the photo that was actually tapped. */}
          {openIndex === null ? null : (
            <FlatList
              data={viewable}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              style={styles.pager}
              keyExtractor={(item) => item.id}
              // contentOffset rather than initialScrollIndex: the latter
              // scrolls programmatically after mount, which fires
              // onMomentumScrollEnd and lands a page off what was tapped.
              contentOffset={{ x: openIndex * width, y: 0 }}
              getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
              // The window is computed from index 0 whatever the offset, so
              // the defaults would download and decode the first ten photos
              // before showing the one that was tapped.
              initialNumToRender={1}
              windowSize={3}
              onMomentumScrollEnd={(event) => {
                const next = Math.round(event.nativeEvent.contentOffset.x / width);
                if (next !== openIndex) setOpenIndex(next);
              }}
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
                  {/* An Image is a view like any other: it occupies its whole
                      box and swallows taps even where `contain` has left that
                      box transparent, which used to leave only a thin strip at
                      each end that would actually dismiss. */}
                  <View pointerEvents="none" style={styles.imageWrap}>
                    <Image source={{ uri: item.url }} style={styles.full} resizeMode="contain" />
                  </View>
                </Pressable>
              )}
            />
          )}

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
  cell: {
    flex: 1 / COLUMNS,
  },
  // No justifyContent here. Centring at this level sizes the pager to its
  // content rather than letting it fill, which left the photo sitting high
  // with the space unevenly split around it. The page centres its own photo,
  // which is the level that knows how much room the bar takes.
  backdrop: {
    flex: 1,
    backgroundColor: colors.photoBackdrop,
  },
  pager: {
    flex: 1,
  },
  page: {
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    // Clears the action bar, so "centred" means centred in the space you can
    // actually see rather than in the whole screen.
    paddingBottom: spacing.xxxl * 2 + spacing.xxl,
  },
  imageWrap: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
  },
  full: {
    width: '100%',
    height: '100%',
  },
  viewerWho: {
    flexShrink: 1,
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
