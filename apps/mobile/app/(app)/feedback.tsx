import { useEffect, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Haptics from 'expo-haptics';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../stores/authStore';
import { pickFromLibrary, uploadJpeg } from '../../lib/images';
import { feedbackSheetOpen } from '../../lib/feedbackState';
import { MIN_TOUCH_TARGET, hitSlopTo } from '../../lib/a11y';
import { ThemedText, showToast } from '../../components/ui';
import { colors, fonts, groupColors, spacing } from '../../theme/tokens';

type Kind = 'broken' | 'idea' | 'other';

const KINDS: { key: Kind; label: string; shape: 'square' | 'circle' | 'diamond'; tint: string }[] = [
  { key: 'broken', label: 'Broken', shape: 'square', tint: groupColors[0] },
  { key: 'idea', label: 'Idea', shape: 'circle', tint: groupColors[1] },
  { key: 'other', label: 'Other', shape: 'diamond', tint: groupColors[2] },
];

/**
 * 14b — one screen, three taps max. Two ways in (user decision 2026-07-29):
 * an OS screenshot arrives with `shot` pre-attached; the profile-sheet row
 * arrives bare, with the library picker as the only way to attach.
 */
export default function FeedbackScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const params = useLocalSearchParams<{ shot?: string }>();
  const fromScreenshot = !!params.shot;

  const [kind, setKind] = useState<Kind | null>(null);
  const [message, setMessage] = useState('');
  const [attachment, setAttachment] = useState<string | null>(params.shot ?? null);

  useEffect(() => {
    feedbackSheetOpen.current = true;
    return () => {
      feedbackSheetOpen.current = false;
    };
  }, []);

  const valid = !!kind && (!!attachment || message.trim().length > 0);

  const send = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('Not signed in');
      let screenshotPath: string | null = null;
      if (attachment) {
        screenshotPath = `${user.id}/${Date.now()}.jpg`;
        await uploadJpeg('feedback-screenshots', screenshotPath, attachment);
      }
      const { error } = await supabase.from('feedback').insert({
        user_id: user.id,
        kind: kind!,
        message: message.trim(),
        screenshot_path: screenshotPath,
        app_version: Constants.expoConfig?.version ?? null,
        device_model: Device.modelName,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      // Profile-row path sits on the profile formSheet; drop both so the
      // toast (rendered under native sheets) is actually visible.
      if (fromScreenshot) {
        router.back();
      } else {
        router.dismiss(2);
      }
      showToast('Got it, thanks. We read every one.');
    },
    onError: (error: Error) => Alert.alert('Error', error.message),
  });

  const addPhoto = async () => {
    const uri = await pickFromLibrary();
    if (uri) setAttachment(uri);
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          testID="cancel"
          style={styles.headerAction}
        >
          <ThemedText variant="bodyStrong" color={colors.textSecondary}>
            Cancel
          </ThemedText>
        </Pressable>
        <ThemedText style={styles.headerTitle}>Send feedback</ThemedText>
        <Pressable
          accessibilityRole="button"
          disabled={!valid || send.isPending}
          onPress={() => send.mutate()}
          testID="send"
          style={[styles.headerAction, styles.headerActionEnd]}
        >
          <ThemedText variant="bodyStrong" color={valid ? colors.accent : colors.textFaint}>
            Send
          </ThemedText>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.section}>
            <ThemedText variant="sectionLabel">What is it?</ThemedText>
            <View style={styles.kindRow}>
              {KINDS.map((k) => {
                const active = kind === k.key;
                return (
                  <Pressable
                    key={k.key}
                    accessibilityRole="button"
                    onPress={() => setKind(k.key)}
                    style={[styles.kindTile, active && styles.kindTileActive]}
                    testID={`kind-${k.key}`}
                  >
                    <View
                      style={[
                        styles.shape,
                        k.shape === 'circle' && styles.shapeCircle,
                        k.shape === 'diamond' && styles.shapeDiamond,
                        { backgroundColor: active ? k.tint : colors.borderStrong },
                      ]}
                    />
                    <ThemedText
                      variant="caption"
                      color={active ? colors.background : colors.textSecondary}
                      style={active ? styles.kindLabelActive : undefined}
                    >
                      {k.label}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.noteWrap}>
            <TextInput
              value={message}
              onChangeText={setMessage}
              placeholder="What happened, or what should exist?"
              placeholderTextColor={colors.textFaint}
              style={styles.note}
              multiline
              testID="message-input"
            />
          </View>

          <View style={styles.section}>
            <View style={styles.attachedLabel}>
              <ThemedText variant="sectionLabel">Attached</ThemedText>
              <ThemedText variant="caption" color={colors.textFaint}>
                {fromScreenshot ? 'the screen you were on' : 'totally optional'}
              </ThemedText>
            </View>
            <View style={styles.thumbRow}>
              {attachment ? (
                <View style={styles.thumbWrap}>
                  <Image source={{ uri: attachment }} style={styles.thumb} testID="attachment" />
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setAttachment(null)}
                    style={styles.thumbRemove}
                    // The one control in the app that keeps hitSlop: a 20pt
                    // badge sitting on the thumbnail it removes, where a real
                    // 44pt box would cover the image underneath it. 8 only got
                    // it to 36 (PLA-40).
                    hitSlop={hitSlopTo(20)}
                    testID="remove-attachment"
                  >
                    <ThemedText variant="caption" color={colors.background}>
                      ×
                    </ThemedText>
                  </Pressable>
                </View>
              ) : null}
              <Pressable
                accessibilityRole="button"
                onPress={addPhoto}
                style={({ pressed }) => [styles.addTile, pressed && styles.pressed]}
                testID="add-photo"
              >
                <ThemedText style={styles.addPlus}>+</ThemedText>
                <ThemedText variant="caption" color={colors.textSecondary}>
                  Add photo
                </ThemedText>
              </Pressable>
            </View>
          </View>

          <ThemedText variant="caption" color={colors.textFaint} style={styles.privacy}>
            Your name, phone model and app version go with it. Nothing from your plans.
          </ThemedText>
        </ScrollView>
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
  },
  // Row padding moved onto the buttons (PLA-40): "Send" is ~36 wide, so the
  // width floor matters as much as the height one here.
  headerAction: {
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
  },
  headerActionEnd: {
    alignItems: 'flex-end',
  },
  headerTitle: {
    fontFamily: fonts.displayHeavy,
    fontSize: 17,
    lineHeight: 21,
    color: colors.textPrimary,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    gap: spacing.xl,
  },
  section: {
    gap: 10,
  },
  kindRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  kindTile: {
    flex: 1,
    alignItems: 'center',
    gap: 7,
    paddingVertical: 14,
    paddingHorizontal: spacing.sm,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
  },
  kindTileActive: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  kindLabelActive: {
    fontFamily: fonts.bodyBold,
  },
  shape: {
    width: 18,
    height: 18,
    borderRadius: 5,
  },
  shapeCircle: {
    borderRadius: 999,
  },
  shapeDiamond: {
    transform: [{ rotate: '45deg' }],
  },
  noteWrap: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    minHeight: 120,
  },
  note: {
    fontFamily: fonts.body,
    fontSize: 16,
    lineHeight: 23,
    color: colors.textPrimary,
    padding: 0,
    flex: 1,
    textAlignVertical: 'top',
  },
  attachedLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  thumbRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  thumbWrap: {
    position: 'relative',
  },
  thumb: {
    width: 86,
    height: 130,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  thumbRemove: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 20,
    height: 20,
    borderRadius: 999,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTile: {
    width: 86,
    height: 130,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  addPlus: {
    fontSize: 22,
    lineHeight: 24,
    color: colors.textFaint,
  },
  privacy: {
    marginTop: 'auto',
    lineHeight: 17,
  },
  pressed: {
    opacity: 0.7,
  },
});
