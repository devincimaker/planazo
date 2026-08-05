import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { supabase } from '../../lib/supabase';
import { captureError } from '../../lib/sentry';
import { contentViolation } from '../../lib/moderation';
import { LINK_HIT_SLOP, useAnnounce } from '../../lib/a11y';
import { useAuthStore } from '../../stores/authStore';
import {
  Avatar,
  Button,
  ConfirmCard,
  FormField,
  ThemedText,
} from '../../components/ui';
import { colors, fonts, spacing } from '../../theme/tokens';

const MIN_PASSWORD = 6;

/**
 * The footer button names the next thing missing rather than sitting there
 * greyed out and mute — design 1a. Order matches the field order on screen.
 */
function nextStep(name: string, email: string, password: string) {
  if (!name.trim()) return { label: 'Add your name to continue', ready: false };
  if (!email.trim()) return { label: 'Add your email to continue', ready: false };
  if (!password) return { label: 'Pick a password to continue', ready: false };
  if (password.length < MIN_PASSWORD) {
    return { label: `Make it ${MIN_PASSWORD} characters or more`, ready: false };
  }
  return { label: 'Make my account', ready: true };
}

export default function SignupScreen() {
  const router = useRouter();
  const { setSession, setProfile } = useAuthStore();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkInbox, setCheckInbox] = useState(false);
  const [loading, setLoading] = useState(false);

  useAnnounce(error);

  const step = nextStep(displayName, email, password);

  async function pickImage() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Photos are off',
        'Planazo needs access to your photo library to set a profile photo. You can turn it on in Settings.',
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });

    if (!result.canceled && result.assets[0]) {
      setAvatarUri(result.assets[0].uri);
    }
  }

  async function uploadAvatar(userId: string): Promise<string | null> {
    if (!avatarUri) return null;

    try {
      const base64 = await FileSystem.readAsStringAsync(avatarUri, { encoding: 'base64' });
      const filePath = `${userId}/avatar.jpg`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, decode(base64), { upsert: true, contentType: 'image/jpeg' });

      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from('avatars').getPublicUrl(filePath);

      return publicUrl;
    } catch (uploadError) {
      // A missing photo is not worth failing the signup over — the account is
      // made either way and the photo can be added from the profile screen.
      captureError(uploadError, 'Avatar upload failed during signup; account created without a photo.');
      return null;
    }
  }

  async function handleSignup() {
    if (!step.ready) {
      setError(step.label);
      return;
    }

    // Guideline 1.2: a display name is content every group member sees.
    const violation = contentViolation({ name: displayName });
    if (violation) {
      setError(violation);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: { data: { display_name: displayName.trim() } },
      });

      if (signUpError) {
        setError(signUpError.message);
        return;
      }

      if (!data.session) {
        // Email confirmation is on: the account exists but there is no session
        // to carry into the app yet.
        setCheckInbox(true);
        return;
      }

      setSession(data.session);

      if (avatarUri) {
        const avatarUrl = await uploadAvatar(data.session.user.id);
        if (avatarUrl) {
          await supabase
            .from('profiles')
            .update({ avatar_url: avatarUrl })
            .eq('id', data.session.user.id);
        }
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.session.user.id)
        .single();

      if (profile) {
        setProfile(profile);
      }

      router.replace('/(app)/(tabs)');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "That didn't go through. Check your connection and try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  if (checkInbox) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <View style={styles.noticeBody}>
          <ConfirmCard title="Your account is made" testID="check-inbox">
            Confirm it from the link we sent to{' '}
            <ThemedText variant="bodyStrong">{email.trim().toLowerCase()}</ThemedText>, then sign
            in. If it hasn&apos;t landed in a minute, check spam.
          </ConfirmCard>
          <Button
            label="Go to sign in"
            variant="outline"
            onPress={() => router.replace('/(auth)/login')}
            style={styles.noticeButton}
            testID="go-to-login"
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.backRow}>
        <Pressable
          accessibilityRole="button"
          hitSlop={LINK_HIT_SLOP}
          onPress={() => router.back()}
          testID="back"
        >
          <ThemedText variant="bodyStrong" color={colors.textSecondary}>
            ‹ Back
          </ThemedText>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <ThemedText variant="screenTitle">Make your account</ThemedText>
          <ThemedText variant="body" color={colors.textSecondary} style={styles.blurb}>
            One minute, and you can start your first plan.
          </ThemedText>

          <View style={styles.photoBlock}>
            <Pressable
              accessibilityRole="button"
              onPress={pickImage}
              style={styles.avatarWrap}
              testID="avatar-press"
            >
              <Avatar name={displayName.trim() || '?'} size={84} imageUrl={avatarUri} />
              <View style={styles.badge}>
                <ThemedText variant="caption" color={colors.textOnAccent}>
                  ✦
                </ThemedText>
              </View>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              hitSlop={LINK_HIT_SLOP}
              onPress={pickImage}
              testID="add-photo"
            >
              <ThemedText variant="caption" color={colors.accentText}>
                Add a photo (optional)
              </ThemedText>
            </Pressable>
          </View>

          <View style={styles.fields}>
            <FormField
              label="Your name"
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Your name"
              autoComplete="name"
              hint="It's what your groups see next to your yes."
              testID="name-input"
            />

            <FormField
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="your@email.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              autoComplete="email"
              testID="email-input"
            />

            <FormField
              label="Password"
              value={password}
              onChangeText={setPassword}
              placeholder={`At least ${MIN_PASSWORD} characters`}
              autoCapitalize="none"
              autoComplete="new-password"
              secure
              testID="password-input"
            />
          </View>

          {error ? (
            <View
              style={styles.errorBox}
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
              testID="signup-error"
            >
              <ThemedText variant="bodyStrong" color={colors.accentText}>
                {error}
              </ThemedText>
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <Button
            label={loading ? 'Making your account…' : step.label}
            variant={step.ready ? 'primary' : 'secondary'}
            disabled={!step.ready || loading}
            onPress={handleSignup}
            testID="create-account"
          />
          <View style={styles.footerRow}>
            <ThemedText variant="sub">Already have an account?</ThemedText>
            <Link href="/(auth)/login" asChild>
              <Pressable accessibilityRole="button" hitSlop={LINK_HIT_SLOP} testID="login-link">
                <ThemedText variant="sub" color={colors.accentText} style={styles.footerLink}>
                  Sign in
                </ThemedText>
              </Pressable>
            </Link>
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
  backRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.xl,
    paddingTop: 6,
  },
  scroll: {
    paddingHorizontal: spacing.xl,
    paddingTop: 18,
    paddingBottom: spacing.xxl,
  },
  blurb: {
    marginTop: spacing.sm,
    maxWidth: 300,
  },
  photoBlock: {
    alignItems: 'center',
    gap: 10,
    marginTop: 22,
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
  fields: {
    gap: spacing.lg,
    marginTop: 22,
  },
  errorBox: {
    marginTop: spacing.xl,
    backgroundColor: colors.accentSoft,
    borderRadius: 14,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  footer: {
    backgroundColor: colors.tabBarBackground,
    borderTopWidth: 1,
    borderTopColor: colors.tabBarBorder,
    paddingHorizontal: spacing.xl,
    paddingTop: 14,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    // At accessibility text sizes "First time here?" and its link no longer
    // fit side by side; wrapping stacks them instead of running off-screen.
    flexWrap: 'wrap',
    gap: 6,
  },
  footerLink: {
    fontFamily: fonts.bodyBold,
  },
  noticeBody: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: 70,
    gap: spacing.xl,
  },
  noticeButton: {
    marginTop: 0,
  },
});
