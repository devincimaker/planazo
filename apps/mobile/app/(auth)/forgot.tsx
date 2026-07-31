import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { supabase } from '../../lib/supabase';
import { Button, ConfirmCard, FormField, ThemedText } from '../../components/ui';
import { colors, fonts, spacing } from '../../theme/tokens';

/**
 * Where the recovery email lands the user back in the app. Supabase only
 * redirects here if the URL is on the project's allow-list — see
 * `supabase/config.toml` locally, and Auth → URL Configuration in the
 * hosted dashboard.
 */
export const RESET_REDIRECT_PATH = '/reset-password';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function sendLink(address: string) {
    const clean = address.trim().toLowerCase();
    if (!clean) {
      setError('Put in your email and we’ll send the link.');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(clean, {
        redirectTo: Linking.createURL(RESET_REDIRECT_PATH),
      });

      // Supabase deliberately succeeds for addresses with no account, so this
      // screen never tells a stranger which emails are registered.
      if (resetError) {
        setError(resetError.message);
        return;
      }

      setSentTo(clean);
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

  if (sentTo) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <View style={styles.sentBody}>
          <ConfirmCard title="The link is out" testID="link-sent">
            It&apos;s on its way to <ThemedText variant="bodyStrong">{sentTo}</ThemedText>. If it
            hasn&apos;t landed in a minute, check spam.
          </ConfirmCard>

          <View style={styles.sentActions}>
            <Button
              label="Back to sign in"
              variant="outline"
              onPress={() => router.replace('/(auth)/login')}
              testID="back-to-login"
            />
            <Pressable
              accessibilityRole="button"
              disabled={loading}
              hitSlop={8}
              onPress={() => sendLink(sentTo)}
              style={styles.resend}
              testID="resend"
            >
              <ThemedText variant="caption" color={loading ? colors.textFaint : colors.accent}>
                {loading ? 'Sending…' : 'Send it again'}
              </ThemedText>
            </Pressable>
          </View>

          {error ? (
            <View style={styles.errorBox} testID="forgot-error">
              <ThemedText variant="bodyStrong" color={colors.accentPressed}>
                {error}
              </ThemedText>
            </View>
          ) : null}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.backRow}>
        <Pressable
          accessibilityRole="button"
          hitSlop={10}
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
          <View style={styles.body}>
            <ThemedText variant="screenTitle" style={styles.title}>
              We&apos;ll send you a link
            </ThemedText>
            <ThemedText variant="body" color={colors.textSecondary} style={styles.blurb}>
              Put in the email you sign in with and we&apos;ll send a link to pick a new password.
            </ThemedText>

            <View style={styles.field}>
              <FormField
                label="Email"
                value={email}
                onChangeText={setEmail}
                placeholder="your@email.com"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                autoComplete="email"
                autoFocus
                testID="email-input"
              />
            </View>

            {error ? (
              <View style={styles.errorBox} testID="forgot-error">
                <ThemedText variant="bodyStrong" color={colors.accentPressed}>
                  {error}
                </ThemedText>
              </View>
            ) : null}

            <Button
              label={loading ? 'Sending…' : 'Send me the link'}
              disabled={loading}
              onPress={() => sendLink(email)}
              style={styles.submit}
              testID="send-link"
            />

            <View style={styles.flex} />

            <View style={styles.footer}>
              <ThemedText variant="sub">Remembered it?</ThemedText>
              <Link href="/(auth)/login" asChild>
                <Pressable accessibilityRole="button" hitSlop={8} testID="login-link">
                  <ThemedText variant="sub" color={colors.accent} style={styles.footerLink}>
                    Sign in
                  </ThemedText>
                </Pressable>
              </Link>
            </View>
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
  backRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.xl,
    paddingTop: 6,
  },
  scroll: {
    flexGrow: 1,
  },
  body: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: 28,
  },
  title: {
    maxWidth: 300,
  },
  blurb: {
    marginTop: 10,
    maxWidth: 305,
  },
  field: {
    marginTop: 30,
  },
  submit: {
    marginTop: spacing.xxl,
  },
  errorBox: {
    marginTop: spacing.xl,
    backgroundColor: colors.accentSoft,
    borderRadius: 14,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingTop: spacing.xxl,
    paddingBottom: 34,
  },
  footerLink: {
    fontFamily: fonts.bodyBold,
  },
  sentBody: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: 70,
  },
  sentActions: {
    marginTop: spacing.xl,
    gap: spacing.md,
  },
  resend: {
    alignSelf: 'center',
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
  },
});
