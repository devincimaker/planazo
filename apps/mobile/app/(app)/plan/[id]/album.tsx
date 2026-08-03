import { useMemo } from 'react';
import { FlatList, Image, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ThemedText } from '../../../../components/ui/ThemedText';
import { planPhotosKey } from '../../../../components/PhotoAlbumCard';
import { supabase } from '../../../../lib/supabase';
import { signPhotos, type PlanPhoto } from '../../../../lib/photos';
import { colors, radii, spacing } from '../../../../theme/tokens';

/**
 * Every photo on a plan.
 *
 * The plan-detail card shows four and a count; this is where the count goes.
 * Three across rather than the card's four, because here the tiles are the
 * content rather than a preview of it.
 *
 * Not designed yet: tapping a tile. The viewer's depth is the one open
 * question on PLA-32, so a tile is inert until that lands rather than half a
 * lightbox nobody asked for.
 */
const COLUMNS = 3;

interface PhotoRow extends PlanPhoto {
  uploader: { display_name: string } | null;
}

export default function PlanAlbumScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

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
    return `${total} photos from ${people} people`;
  }, [rows]);

  // The rows arrive before the signatures do, so the grid can hold its shape
  // with placeholder tiles instead of reflowing when the images land.
  const tiles = signed?.length ? signed : (rows ?? []).map((r) => ({ ...r, url: '' }));

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
          <View
            style={[
              styles.tile,
              { backgroundColor: index % 2 ? colors.photoPlaceholderAlt : colors.photoPlaceholder },
            ]}
          >
            {item.url ? (
              <Image source={{ uri: item.url }} style={styles.fill} resizeMode="cover" />
            ) : null}
          </View>
        )}
      />
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
});
