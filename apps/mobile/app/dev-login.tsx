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

    (async () => {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (cancelled) return;
      if (error || !data.session) {
        setMessage(error?.message ?? 'No session returned');
        setStatus('failed');
        return;
      }
      setSession(data.session);
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.session.user.id)
        .single();
      if (cancelled) return;
      if (profile) setProfile(profile);
      setStatus('done');
    })();

    return () => {
      cancelled = true;
    };
  }, [email, password, setProfile, setSession]);

  if (!__DEV__) return <Redirect href="/" />;
  if (status === 'done') return <Redirect href="/(app)/(tabs)" />;

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
