import { useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../stores/authStore';
import { pickFromLibrary, takePhoto, uploadJpeg } from '../../../lib/images';
import { Avatar, ThemedText } from '../../../components/ui';
import { colors, fonts, spacing } from '../../../theme/tokens';

type PhotoDraft = { kind: 'keep' } | { kind: 'remove' } | { kind: 'new'; uri: string };

const PHOTO_SHEET_TITLE = 'Your photo is what friends see next to your yes';

/**
 * 12c — the edit screen behind the sheet's one Edit button. Save greys out
 * until something actually changed; the photo sheet (11b) keeps "use my
 * initial" as the honest default.
 */
export default function ProfileEdit() {
  const router = useRouter();
  const { profile, setProfile } = useAuthStore();
  const [name, setName] = useState(profile?.display_name ?? '');
  const [photo, setPhoto] = useState<PhotoDraft>({ kind: 'keep' });

  const trimmed = name.trim();
  const nameChanged = trimmed.length > 0 && trimmed !== profile?.display_name;
  const photoChanged =
    photo.kind === 'new' || (photo.kind === 'remove' && !!profile?.avatar_url);
  const dirty = nameChanged || photoChanged;

  const save = useMutation({
    mutationFn: async () => {
      const updates: { display_name?: string; avatar_url?: string | null } = {};
      if (nameChanged) updates.display_name = trimmed;
      if (photo.kind === 'new') {
        const path = `${profile!.id}/avatar.jpg`;
        await uploadJpeg('avatars', path, photo.uri, true);
        const { data } = supabase.storage.from('avatars').getPublicUrl(path);
        updates.avatar_url = `${data.publicUrl}?t=${Date.now()}`;
      } else if (photo.kind === 'remove') {
        updates.avatar_url = null;
      }
      const { data, error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', profile!.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      setProfile(data);
      router.back();
    },
    onError: (error: Error) => Alert.alert('Error', error.message),
  });

  const applyChoice = async (index: number) => {
    if (index === 0) {
      const uri = await takePhoto();
      if (uri) setPhoto({ kind: 'new', uri });
    } else if (index === 1) {
      const uri = await pickFromLibrary({ square: true });
      if (uri) setPhoto({ kind: 'new', uri });
    } else if (index === 2) {
      setPhoto({ kind: 'remove' });
    }
  };

  const openPhotoOptions = () => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: PHOTO_SHEET_TITLE,
          options: ['Take a photo', 'Choose from library', 'Use my initial instead', 'Cancel'],
          cancelButtonIndex: 3,
          destructiveButtonIndex: 2,
        },
        (index) => {
          if (index !== 3) void applyChoice(index);
        }
      );
    } else {
      Alert.alert('Change photo', PHOTO_SHEET_TITLE, [
        { text: 'Take a photo', onPress: () => void applyChoice(0) },
        { text: 'Choose from library', onPress: () => void applyChoice(1) },
        { text: 'Use my initial instead', onPress: () => void applyChoice(2) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  const shownUri =
    photo.kind === 'new' ? photo.uri : photo.kind === 'keep' ? profile?.avatar_url : null;
  const draftName = trimmed || profile?.display_name || '?';

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} testID="cancel">
          <ThemedText variant="bodyStrong" color={colors.textSecondary}>
            Cancel
          </ThemedText>
        </Pressable>
        <ThemedText style={styles.headerTitle}>Your profile</ThemedText>
        <Pressable
          accessibilityRole="button"
          disabled={!dirty || save.isPending}
          onPress={() => save.mutate()}
          testID="save"
        >
          <ThemedText variant="bodyStrong" color={dirty ? colors.accent : colors.textFaint}>
            Save
          </ThemedText>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.body}>
          <View style={styles.photoBlock}>
            <Pressable
              accessibilityRole="button"
              onPress={openPhotoOptions}
              style={styles.avatarWrap}
              testID="avatar-press"
            >
              <Avatar name={draftName} dark size={96} imageUrl={shownUri} />
              <View style={styles.badge}>
                <ThemedText variant="caption" color={colors.textOnAccent}>
                  ✦
                </ThemedText>
              </View>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={openPhotoOptions} testID="change-photo">
              <ThemedText variant="bodyStrong" color={colors.accent} style={styles.changePhoto}>
                Change photo
              </ThemedText>
            </Pressable>
          </View>

          <View style={styles.field}>
            <ThemedText variant="sectionLabel">Your name</ThemedText>
            <View style={styles.inputWrap}>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Your name"
                placeholderTextColor={colors.textFaint}
                style={styles.input}
                autoFocus
                testID="name-input"
              />
            </View>
            <ThemedText variant="caption" style={styles.hint}>
              This is what your groups see next to your yes.
              {profile?.handle ? ` Your handle @${profile.handle} can't change — invite links point at it.` : ''}
            </ThemedText>
          </View>
        </View>
      </KeyboardAvoidingView>
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
    paddingTop: spacing.lg,
    paddingBottom: 10,
  },
  headerTitle: {
    fontFamily: fonts.displayHeavy,
    fontSize: 17,
    lineHeight: 21,
    color: colors.textPrimary,
  },
  body: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: 14,
    gap: 26,
  },
  photoBlock: {
    alignItems: 'center',
    gap: spacing.md,
  },
  avatarWrap: {
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: 26,
    height: 26,
    borderRadius: 999,
    backgroundColor: colors.accent,
    borderWidth: 2.5,
    borderColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  changePhoto: {
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
  },
  field: {
    gap: spacing.sm,
  },
  inputWrap: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.accent,
    borderRadius: 18,
    paddingVertical: 15,
    paddingHorizontal: spacing.lg,
  },
  input: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 17,
    color: colors.textPrimary,
    padding: 0,
  },
  hint: {
    lineHeight: 19,
  },
});
