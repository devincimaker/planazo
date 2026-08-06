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
import { supabase } from '../../lib/supabase';
import { LINK_HIT_SLOP, useAnnounce } from '../../lib/a11y';
import { useAuthStore } from '../../stores/authStore';
import { BrandMark, Button, FormField, ThemedText } from '../../components/ui';
import { colors, fonts, spacing } from '../../theme/tokens';

export default function LoginScreen() {
  const router = useRouter();
  const { setSession, setProfile } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useAnnounce(error);

  async function handleLogin() {
    if (!email.trim() || !password) {
      setError('Put in your email and password to carry on.');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (signInError) {
        // Someone who quit signup before entering their code lands here, and
        // used to get Supabase's raw "Email not confirmed" with nothing to do
        // about it. Their account exists and we know the address, so send them
        // to the code step instead, which sends them a fresh one on arrival.
        if (signInError.code === 'email_not_confirmed') {
          router.replace({
            pathname: '/(auth)/signup',
            params: { verify: email.trim().toLowerCase() },
          });
          return;
        }
        setError(signInError.message);
        return;
      }

      setSession(data.session);

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
          testID="login-scroll"
        >
          <View style={styles.body} testID="login-body">
            <BrandMark size={52} />

            <ThemedText variant="screenTitle" style={styles.title}>
              Welcome back
            </ThemedText>

            <View style={styles.fields}>
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
                placeholder="Your password"
                autoCapitalize="none"
                autoComplete="password"
                secure
                testID="password-input"
              />

              <View style={styles.forgotRow}>
                <Link href="/(auth)/forgot" asChild>
                  <Pressable accessibilityRole="button" hitSlop={LINK_HIT_SLOP} testID="forgot-link">
                    <ThemedText variant="caption" color={colors.accentText}>
                      Forgot your password?
                    </ThemedText>
                  </Pressable>
                </Link>
              </View>
            </View>

            {error ? (
              <View
                style={styles.errorBox}
                accessibilityRole="alert"
                accessibilityLiveRegion="assertive"
                testID="login-error"
              >
                <ThemedText variant="bodyStrong" color={colors.accentText}>
                  {error}
                </ThemedText>
              </View>
            ) : null}

          </View>
        </ScrollView>

        {/*
          Outside the ScrollView, inside the KeyboardAvoidingView, so both ways
          out of this screen survive the keyboard opening. They used to sit at
          the end of the scrolling content, where a raised keyboard pushed them
          below the fold — and a first-timer who never found "Make your account"
          typed their details into this form instead (PLA-69). Same structure as
          signup.tsx.
        */}
        <View style={styles.footer} testID="login-footer">
          <Button
            label={loading ? 'Signing in…' : 'Sign in'}
            onPress={handleLogin}
            disabled={loading}
            testID="sign-in"
          />

          <View style={styles.footerRow} testID="login-footer-row">
            <ThemedText variant="sub">First time here?</ThemedText>
            <Link href="/(auth)/signup" asChild>
              <Pressable accessibilityRole="button" hitSlop={LINK_HIT_SLOP} testID="signup-link">
                <ThemedText variant="sub" color={colors.accentText} style={styles.footerLink}>
                  Make your account
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
  scroll: {
    flexGrow: 1,
  },
  body: {
    // flexGrow, not flex. `flex: 1` clamps this to the ScrollView's height, so
    // at large text sizes the content overflowed instead of making the view
    // scrollable, and the bottom of the form became unreachable.
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    // This, `title.marginTop` and `fields.marginTop` were all tightened
    // together, and are deliberately smaller than they look like they should
    // be. The pinned footer takes ~110pt off the scrolling area; with a
    // keyboard up as well, this spacing is what keeps "Forgot your password?"
    // from falling under the footer on a normal phone. Round any of the three
    // up to the nearest token and it slides back under. On smaller phones it
    // scrolls instead, which is fine: the two actions that matter are pinned.
    paddingTop: 22,
    paddingBottom: spacing.lg,
  },
  title: {
    marginTop: 18,
  },
  fields: {
    gap: 18,
    marginTop: spacing.xxl,
  },
  forgotRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
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
});
