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
        setError(signInError.message);
        return;
      }

      setSession(data.session);

      if (data.session?.user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', data.session.user.id)
          .single();

        if (profile) {
          setProfile(profile);
        }
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
        >
          <View style={styles.body}>
            <BrandMark size={52} />

            <ThemedText variant="screenTitle" style={styles.title}>
              Good to see you
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
                  <Pressable accessibilityRole="button" hitSlop={8} testID="forgot-link">
                    <ThemedText variant="caption" color={colors.accent}>
                      Forgot your password?
                    </ThemedText>
                  </Pressable>
                </Link>
              </View>
            </View>

            {error ? (
              <View style={styles.errorBox} testID="login-error">
                <ThemedText variant="bodyStrong" color={colors.accentPressed}>
                  {error}
                </ThemedText>
              </View>
            ) : null}

            <Button
              label={loading ? 'Signing in…' : 'Sign in'}
              onPress={handleLogin}
              disabled={loading}
              style={styles.submit}
              testID="sign-in"
            />

            <View style={styles.flex} />

            <View style={styles.footer}>
              <ThemedText variant="sub">First time here?</ThemedText>
              <Link href="/(auth)/signup" asChild>
                <Pressable accessibilityRole="button" hitSlop={8} testID="signup-link">
                  <ThemedText variant="sub" color={colors.accent} style={styles.footerLink}>
                    Make your account
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
  scroll: {
    flexGrow: 1,
  },
  body: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: 34,
  },
  title: {
    marginTop: 26,
  },
  fields: {
    gap: 18,
    marginTop: spacing.xxxl,
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
  submit: {
    marginTop: 26,
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
});
