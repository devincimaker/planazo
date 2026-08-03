import { useState } from 'react';
import { View, StyleSheet, Pressable, TextInput, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../../../lib/supabase';
import { contentViolation } from '../../../../lib/moderation';
import { removeGroupPhoto, uploadGroupPhoto } from '../../../../lib/images';
import { captureError } from '../../../../lib/sentry';
import { MIN_TOUCH_TARGET } from '../../../../lib/a11y';
import { ThemedText, GroupTile, GroupPhotoField } from '../../../../components/ui';
import { colors, fonts, groupColors, spacing } from '../../../../theme/tokens';

type PhotoDraft = { kind: 'keep' } | { kind: 'remove' } | { kind: 'new'; uri: string };

/** 6e "Group profile" — the photo, the name and the colour, nothing else. */
export default function EditGroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState<string | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const [photo, setPhoto] = useState<PhotoDraft>({ kind: 'keep' });

  const { data: group } = useQuery({
    queryKey: ['group-edit', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('groups')
        .select('id, name, color, image_url')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data as any;
    },
    enabled: !!id,
  });

  const draftName = name ?? group?.name ?? '';
  const draftColor = color ?? group?.color ?? groupColors[0];
  const draftImage =
    photo.kind === 'new' ? photo.uri : photo.kind === 'remove' ? null : group?.image_url ?? null;
  const photoChanged =
    photo.kind === 'new' || (photo.kind === 'remove' && !!group?.image_url);
  const dirty =
    !!group &&
    (draftName.trim() !== group.name ||
      draftColor !== (group.color ?? groupColors[0]) ||
      photoChanged);
  const valid = draftName.trim().length > 0;

  const save = useMutation({
    mutationFn: async () => {
      // Guideline 1.2: objectionable language stops here, not in review.
      const violation = contentViolation({ 'group name': draftName });
      if (violation) throw new Error(violation);
      const updates: { name: string; color: string; image_url?: string | null } = {
        name: draftName.trim(),
        color: draftColor,
      };
      if (photo.kind === 'new') {
        updates.image_url = await uploadGroupPhoto(id, photo.uri);
      } else if (photo.kind === 'remove') {
        updates.image_url = null;
      }
      const { error } = await supabase.from('groups').update(updates).eq('id', id);
      if (error) throw error;

      // Only once the row has stopped pointing at it. An orphaned object is
      // untidy; a row pointing at a deleted one is a broken tile.
      if (photo.kind === 'remove') {
        try {
          await removeGroupPhoto(id);
        } catch (e) {
          captureError(e, 'group photo delete');
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['group', id] });
      queryClient.invalidateQueries({ queryKey: ['group-manage', id] });
      queryClient.invalidateQueries({ queryKey: ['group-edit', id] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      queryClient.invalidateQueries({ queryKey: ['home-plans'] });
      router.back();
    },
    onError: (error: Error) => Alert.alert('Error', error.message),
  });

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          testID="cancel"
          style={styles.headerAction}
        >
          <ThemedText variant="bodyStrong" color={colors.textMuted}>
            Cancel
          </ThemedText>
        </Pressable>
        <ThemedText style={styles.headerTitle}>Group profile</ThemedText>
        <Pressable
          onPress={() => save.mutate()}
          disabled={!dirty || !valid || save.isPending}
          accessibilityRole="button"
          testID="save"
          style={[styles.headerAction, styles.headerActionEnd]}
        >
          <ThemedText
            variant="bodyStrong"
            color={dirty && valid ? colors.accent : colors.textFaint}
          >
            Save
          </ThemedText>
        </Pressable>
      </View>

      <View style={styles.content}>
        <View style={styles.nameRow}>
          <GroupTile
            name={valid ? draftName : '?'}
            color={draftColor}
            imageUrl={draftImage}
            size={52}
          />
          <View style={styles.nameBlock}>
            <TextInput
              style={styles.nameInput}
              placeholder="Name the group"
              placeholderTextColor={colors.textFaint}
              value={draftName}
              onChangeText={setName}
              testID="name-input"
            />
            <View style={styles.rule} />
          </View>
        </View>

        <GroupPhotoField
          uri={draftImage}
          uploading={save.isPending && photo.kind === 'new'}
          caption="Remove it and the letter comes back, on the colour you had."
          onPick={(uri) => setPhoto({ kind: 'new', uri })}
          onRemove={() => setPhoto({ kind: 'remove' })}
        />

        {draftImage ? (
          // The colour is still stored, and still what the feed's card stripe
          // and the group dots use. It just has nothing to do on a tile the
          // photo has taken over, so picking one here would be a lie.
          <ThemedText variant="sub">
            Colour is hidden while a photo is set. It comes back the moment the photo goes.
          </ThemedText>
        ) : (
          <View style={styles.section}>
            <ThemedText variant="sectionLabel">Colour</ThemedText>
            <View style={styles.swatches}>
              {groupColors.map((swatch) => (
                <Pressable
                  key={swatch}
                  accessibilityRole="button"
                  accessibilityState={{ selected: swatch === draftColor }}
                  onPress={() => setColor(swatch)}
                  style={[
                    styles.swatch,
                    { backgroundColor: swatch },
                    swatch === draftColor && styles.swatchSelected,
                  ]}
                />
              ))}
            </View>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  // Row padding moved onto the buttons (PLA-40). "Save" is only ~36 wide, so
  // this needs the width floor too — the box grows, the word does not move.
  headerAction: {
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
  },
  // On the right of the row, so grow leftwards and keep the label flush.
  headerActionEnd: {
    alignItems: 'flex-end',
  },
  headerTitle: {
    fontFamily: fonts.display,
    fontSize: 17,
    lineHeight: 21,
    color: colors.textPrimary,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    gap: spacing.xxl,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  nameBlock: {
    flex: 1,
    gap: spacing.sm,
  },
  nameInput: {
    fontFamily: fonts.displayHeavy,
    fontSize: 26,
    letterSpacing: -0.52,
    color: colors.textPrimary,
    padding: 0,
  },
  rule: {
    height: 2,
    backgroundColor: colors.borderStrong,
  },
  section: {
    gap: 10,
  },
  swatches: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  swatch: {
    width: 46,
    height: 46,
    borderRadius: 15,
    borderWidth: 2.5,
    borderColor: 'transparent',
  },
  swatchSelected: {
    borderColor: colors.ink,
  },
});
