import { useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Pressable,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../../lib/supabase';
import { contentViolation } from '../../../lib/moderation';
import { useFriends } from '../../../lib/useFriends';
import { uploadGroupPhoto } from '../../../lib/images';
import { captureError } from '../../../lib/sentry';
import { MIN_TOUCH_TARGET } from '../../../lib/a11y';
import {
  ThemedText,
  Card,
  Button,
  Avatar,
  GroupTile,
  GroupPhotoField,
  showToast,
} from '../../../components/ui';
import { colors, fonts, groupColors, radii, spacing, type } from '../../../theme/tokens';

export default function NewGroupScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();

  // Params preseed the sheet for deep-link QA (same pattern as plan/create):
  // planazo://group/new?name=Padel&desc=Monday%20nights&color=2&y=0
  const params = useLocalSearchParams<{
    name?: string;
    desc?: string;
    color?: string;
    y?: string;
  }>();

  const [name, setName] = useState(params.name ?? '');
  const [desc, setDesc] = useState(params.desc ?? '');
  const [colorIdx, setColorIdx] = useState(() =>
    Math.min(groupColors.length - 1, Math.max(0, Number(params.color) || 0))
  );
  const [picks, setPicks] = useState<string[]>([]);
  const [photoUri, setPhotoUri] = useState<string | null>(null);

  // 17c "Your people": accepted friendships, either direction.
  const { friends } = useFriends();

  const togglePick = (id: string) =>
    setPicks((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));

  const createGroup = useMutation({
    mutationFn: async () => {
      // Guideline 1.2: objectionable language stops here, not in review.
      const violation = contentViolation({
        'group name': name,
        'group description': desc,
      });
      if (violation) throw new Error(violation);
      // PLA-35: the group row and the creator's admin membership are one
      // server-side write. The client can no longer insert either, and a
      // half-created group was an orphan nobody could see or delete.
      const { data: group, error: groupError } = await supabase.rpc('create_group', {
        p_name: name.trim(),
        p_description: desc.trim() || null,
        p_color: groupColors[colorIdx],
      });
      if (groupError) throw groupError;

      // PLA-30: the storage policy keys on being an admin of the group, and
      // that membership only exists once create_group has returned, so the
      // photo cannot go up any earlier than this.
      if (photoUri) {
        try {
          const imageUrl = await uploadGroupPhoto(group.id, photoUri);
          const { error: photoError } = await supabase
            .from('groups')
            .update({ image_url: imageUrl })
            .eq('id', group.id);
          if (photoError) throw photoError;
        } catch (e) {
          // The group exists by now. Failing the whole create would read as
          // "nothing happened" while leaving one behind, so the group wins and
          // the photo is something they can add again.
          captureError(e, 'group photo upload');
          showToast("Group created, but the photo didn't upload. Try again from Group profile.");
        }
      }

      await Promise.all(
        picks.map((invitee) =>
          supabase.rpc('invite_to_group', { p_group_id: group.id, p_invitee: invitee })
        )
      );
      return group;
    },
    onSuccess: (group) => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      router.back();
      setTimeout(() => router.push(`/(app)/group/${group.id}`), 100);
    },
    onError: (error: Error) => Alert.alert('Error', error.message),
  });

  const named = name.trim().length > 0;
  const selectedFriends = (friends ?? []).filter((f) => picks.includes(f.id));
  const ctaLabel = !named
    ? 'Name it first'
    : createGroup.isPending
      ? 'Creating…'
      : picks.length > 0
        ? `Create and invite ${picks.length}`
        : 'Create group';

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
        <ThemedText style={styles.headerTitle}>New group</ThemedText>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          contentOffset={params.y ? { x: 0, y: Number(params.y) } : undefined}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.nameRow}>
            <GroupTile
              name={named ? name : '?'}
              color={groupColors[colorIdx]}
              imageUrl={photoUri}
              size={52}
            />
            <View style={styles.nameBlock}>
              <TextInput
                style={styles.nameInput}
                placeholder="Name the group"
                placeholderTextColor={colors.textFaint}
                value={name}
                onChangeText={setName}
                testID="name-input"
              />
              <View style={styles.rule} />
            </View>
          </View>

          <GroupPhotoField
            uri={photoUri}
            uploading={createGroup.isPending && !!photoUri}
            caption="The photo is the group's tile everywhere."
            onPick={setPhotoUri}
            onRemove={() => setPhotoUri(null)}
          />

          {photoUri ? null : (
            <View style={styles.section}>
              <ThemedText variant="sectionLabel">Colour</ThemedText>
              <View style={styles.swatches}>
                {groupColors.map((swatch, i) => (
                  <Pressable
                    key={swatch}
                    accessibilityRole="button"
                    accessibilityState={{ selected: i === colorIdx }}
                    onPress={() => setColorIdx(i)}
                    style={[
                      styles.swatch,
                      { backgroundColor: swatch },
                      i === colorIdx && styles.swatchSelected,
                    ]}
                    testID={`swatch-${i}`}
                  />
                ))}
              </View>
            </View>
          )}

          <View style={styles.section}>
            <ThemedText variant="sectionLabel">What's it for</ThemedText>
            <TextInput
              style={styles.descInput}
              placeholder="One line so people know what they're joining. Skippable."
              placeholderTextColor={colors.textFaint}
              value={desc}
              onChangeText={setDesc}
              multiline
              testID="desc-input"
            />
          </View>

          <View style={styles.section}>
            <View style={styles.pickerHeader}>
              <ThemedText variant="sectionLabel">Who's in</ThemedText>
              {picks.length > 0 ? (
                <ThemedText variant="caption" color={colors.textPrimary}>
                  {picks.length} selected
                </ThemedText>
              ) : null}
            </View>

            {selectedFriends.length > 0 ? (
              <View style={styles.chipWrap}>
                {selectedFriends.map((f) => (
                  <Pressable
                    key={f.id}
                    accessibilityRole="button"
                    onPress={() => togglePick(f.id)}
                    style={styles.selectedChip}
                    testID={`chip-${f.id}`}
                  >
                    <Avatar name={f.name} size={22} imageUrl={f.avatarUrl} />
                    <ThemedText variant="caption" color={colors.background}>
                      {f.name.split(' ')[0]}
                    </ThemedText>
                    <ThemedText variant="caption" color={colors.textMuted}>
                      ×
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {(friends ?? []).length === 0 ? (
              <ThemedText variant="sub">
                Friends you add on Planazo show up here. You can also invite people once the
                group exists.
              </ThemedText>
            ) : (
              <Card padded={false}>
                {(friends ?? []).map((f, i) => {
                  const picked = picks.includes(f.id);
                  return (
                    <Pressable
                      key={f.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: picked }}
                      onPress={() => togglePick(f.id)}
                      style={({ pressed }) => [
                        styles.personRow,
                        i > 0 && styles.personDivider,
                        pressed && styles.personPressed,
                      ]}
                      testID={`person-${f.id}`}
                    >
                      <Avatar name={f.name} size={40} imageUrl={f.avatarUrl} />
                      <View style={styles.personBody}>
                        <ThemedText variant="bodyStrong" numberOfLines={1}>
                          {f.name}
                        </ThemedText>
                        {f.handle ? (
                          <ThemedText variant="caption">@{f.handle}</ThemedText>
                        ) : null}
                      </View>
                      <View style={[styles.check, picked && styles.checkOn]}>
                        {picked ? (
                          <ThemedText variant="tag" color={colors.textOnAccent}>
                            ✓
                          </ThemedText>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })}
              </Card>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={styles.footer}>
        <Button
          label={ctaLabel}
          variant={named ? 'primary' : 'secondary'}
          disabled={!named || createGroup.isPending}
          haptic={named}
          onPress={() => createGroup.mutate()}
          testID="create-cta"
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  // Row padding moved onto the button so the whole bar height takes the tap
  // (PLA-40). Row goes 45 → 44; nothing else moves.
  headerAction: {
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET,
  },
  headerTitle: {
    fontFamily: fonts.display,
    fontSize: 17,
    lineHeight: 21,
    color: colors.textPrimary,
  },
  headerSpacer: {
    width: 48,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: 140,
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
  descInput: {
    ...type.body,
    height: 80,
    textAlignVertical: 'top',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 18,
    padding: 15,
  },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  // 34 (6 + 22 avatar + 6) with a "×" on it — removing someone you added by
  // mistake should not need aim (PLA-40).
  selectedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET,
    gap: 7,
    backgroundColor: colors.ink,
    borderRadius: radii.pill,
    paddingVertical: 6,
    paddingLeft: 6,
    paddingRight: 11,
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 13,
    paddingHorizontal: 15,
  },
  personDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  personPressed: {
    backgroundColor: colors.surfaceSunken,
  },
  personBody: {
    flex: 1,
    gap: 1,
  },
  check: {
    width: 24,
    height: 24,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.tabBarBackground,
    borderTopWidth: 1,
    borderTopColor: colors.tabBarBorder,
    paddingHorizontal: spacing.xl,
    paddingTop: 14,
    paddingBottom: 30,
  },
});
