import { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import { ThemedText } from '../components/ui';
import { colors, spacing } from '../theme/tokens';

// Dev-only: sign in without typing, for simulator tooling and Maestro flows.
//   planazo://dev-login?email=<email>&password=<password>
export default function DevLogin() {
  const { email, password } = useLocalSearchParams<{ email?: string; password?: string }>();
  const { setSession, setProfile } = useAuthStore();
  const [status, setStatus] = useState<'working' | 'done' | 'failed'>('working');
  const [message, setMessage] = useState('Signing in…');

  useEffect(() => {
    if (!__DEV__ || !email || !password) return;
    let cancelled = false;

    // Failures land in the on-screen status; supabase-js returns errors
    // rather than throwing, so there is no rejection path left to catch.
    void (async () => {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      // The cleanup below flips `cancelled` on unmount; TS cannot see an
      // assignment on the other side of an await (microsoft/TypeScript#9998).
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (cancelled) return;
      if (error) {
        setMessage(error.message);
        setStatus('failed');
        return;
      }
      setSession(data.session);
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.session.user.id)
        .single();
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- same await/closure blind spot as above
      if (cancelled) return;
      if (profile) setProfile(profile);
      setStatus('done');
    })();

    return () => {
      cancelled = true;
    };
  }, [email, password, setProfile, setSession]);

  if (!__DEV__) return <Redirect href="/" />;
  // Index, not the tabs: it owns the first-run gate (PLA-75), and a dev sign-in
  // that skipped it would be the one entry point that can't reach onboarding.
  if (status === 'done') return <Redirect href="/" />;

  return (
    <View style={styles.container}>
      {status === 'working' ? <ActivityIndicator size="large" color={colors.accent} /> : null}
      <ThemedText variant="sub">{status === 'failed' ? `Dev login failed: ${message}` : message}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    backgroundColor: colors.background,
    padding: spacing.xxl,
  },
});
