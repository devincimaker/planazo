import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { supabase } from '../../lib/supabase';
import { LINK_HIT_SLOP, useAnnounce } from '../../lib/a11y';
import { Button, FormField, ThemedText } from '../../components/ui';
import { colors, spacing } from '../../theme/tokens';

const MIN_PASSWORD = 6;

/**
 * Supabase hands the recovery tokens back in the URL *fragment*, not the query
 * string, so expo-router's search params never see them. `detectSessionInUrl`
 * is off (it is a web-only convenience), which leaves parsing to us.
 */
function tokensFromUrl(url: string) {
  const parts: Record<string, string> = {};
  for (const chunk of [url.split('#')[1], url.split('#')[0]?.split('?')[1]]) {
    if (!chunk) continue;
    for (const pair of chunk.split('&')) {
      const [rawKey, rawValue] = pair.split('=');
      if (!rawKey || rawValue === undefined) continue;
      parts[decodeURIComponent(rawKey)] = decodeURIComponent(rawValue.replace(/\+/g, ' '));
    }
  }
  return parts;
}

type Stage =
  | { kind: 'waiting' }
  | { kind: 'ready' }
  | { kind: 'dead'; reason: string };

export default function ResetPasswordScreen() {
  const router = useRouter();
  const url = Linking.useURL();
  const [stage, setStage] = useState<Stage>({ kind: 'waiting' });
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useAnnounce(error);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;

    async function adopt(currentUrl: string) {
      const parts = tokensFromUrl(currentUrl);

      if (parts.error_description || parts.error) {
        if (!cancelled) {
          setStage({
            kind: 'dead',
            reason:
              parts.error_code === 'otp_expired'
                ? 'That link has expired. Ask for a new one and it should land in a minute.'
                : parts.error_description || 'That link is no longer good.',
          });
        }
        return;
      }

      if (!parts.access_token || !parts.refresh_token) {
        if (!cancelled) {
          setStage({
            kind: 'dead',
            reason: 'Open this screen from the link in the email and it will know who you are.',
          });
        }
        return;
      }

      const { error: sessionError } = await supabase.auth.setSession({
        access_token: parts.access_token,
        refresh_token: parts.refresh_token,
      });

      if (cancelled) return;
      setStage(
        sessionError
          ? { kind: 'dead', reason: sessionError.message }
          : { kind: 'ready' },
      );
    }

    void adopt(url);
    return () => {
      cancelled = true;
    };
  }, [url]);

  async function savePassword() {
    if (password.length < MIN_PASSWORD) {
      setError(`Make it ${MIN_PASSWORD} characters or more.`);
      return;
    }

    try {
      setSaving(true);
      setError(null);
      const { error: updateError } = await supabase.auth.updateUser({ password });

      if (updateError) {
        setError(updateError.message);
        return;
      }

      router.replace('/(app)/(tabs)');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "That didn't go through. Check your connection and try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (stage.kind !== 'ready') {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <View style={styles.centred}>
          {stage.kind === 'waiting' ? (
            <ThemedText variant="body" color={colors.textSecondary}>
              Checking your link…
            </ThemedText>
          ) : (
            <>
              <ThemedText variant="screenTitle">That link is stale</ThemedText>
              <ThemedText variant="body" color={colors.textSecondary} style={styles.blurb}>
                {stage.reason}
              </ThemedText>
              <Button
                label="Ask for a new link"
                onPress={() => router.replace('/(auth)/forgot')}
                style={styles.submit}
                testID="new-link"
              />
              <Pressable
                accessibilityRole="button"
                hitSlop={LINK_HIT_SLOP}
                onPress={() => router.replace('/(auth)/login')}
                style={styles.quietAction}
                testID="back-to-login"
              >
                <ThemedText variant="caption" color={colors.accentText}>
                  Back to sign in
                </ThemedText>
              </Pressable>
            </>
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View style={styles.body}>
            <ThemedText variant="screenTitle">Pick a new password</ThemedText>
            <ThemedText variant="body" color={colors.textSecondary} style={styles.blurb}>
              Choose something you&apos;ll remember. We&apos;ll take you straight in afterwards.
            </ThemedText>

            <View style={styles.field}>
              <FormField
                label="New password"
                value={password}
                onChangeText={setPassword}
                placeholder={`At least ${MIN_PASSWORD} characters`}
                autoCapitalize="none"
                autoComplete="new-password"
                secure
                autoFocus
                testID="password-input"
              />
            </View>

            {error ? (
              <View
                style={styles.errorBox}
                accessibilityRole="alert"
                accessibilityLiveRegion="assertive"
                testID="reset-error"
              >
                <ThemedText variant="bodyStrong" color={colors.accentText}>
                  {error}
                </ThemedText>
              </View>
            ) : null}

            <Button
              label={saving ? 'Saving…' : 'Save and go in'}
              disabled={saving}
              onPress={savePassword}
              style={styles.submit}
              testID="save-password"
            />
          </View>
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
  scroll: {
    flexGrow: 1,
  },
  body: {
    // flexGrow, not flex. `flex: 1` clamps this to the ScrollView's height, so
    // at large text sizes the content overflowed instead of making the view
    // scrollable — the sign-in button ended up below the fold, unreachable.
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: 60,
  },
  centred: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  blurb: {
    marginTop: 10,
    maxWidth: 305,
  },
  field: {
    marginTop: 30,
  },
  errorBox: {
    marginTop: spacing.xl,
    backgroundColor: colors.accentSoft,
    borderRadius: 14,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  submit: {
    marginTop: spacing.xxl,
  },
  quietAction: {
    alignSelf: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
});
