import { useEffect, useState } from 'react';
import { Slot, useRouter, useRootNavigationState } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, StyleSheet, AppState, AppStateStatus } from 'react-native';
import * as Notifications from 'expo-notifications';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import {
  BricolageGrotesque_700Bold,
  BricolageGrotesque_800ExtraBold,
} from '@expo-google-fonts/bricolage-grotesque';
import {
  InstrumentSans_400Regular,
  InstrumentSans_500Medium,
  InstrumentSans_600SemiBold,
  InstrumentSans_700Bold,
} from '@expo-google-fonts/instrument-sans';
import { supabase } from '../lib/supabase';
import { initNotificationPresentation, registerPushToken } from '../lib/push';
import { retryQuery } from '../lib/queryErrors';
import { useAuthStore } from '../stores/authStore';
import { COLORS } from '../constants/colors';

SplashScreen.preventAutoHideAsync();

// react-query's default focus tracking is web-only, so returning to the app
// never kicked a stale or stuck query (PLA-15). AppState is the RN equivalent.
focusManager.setEventListener((handleFocus) => {
  const subscription = AppState.addEventListener('change', (status: AppStateStatus) => {
    handleFocus(status === 'active');
  });
  return () => subscription.remove();
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: retryQuery,
      // Coming back from the background is the moment a hung request most needs
      // replacing, so refetch even if the data isn't stale yet.
      refetchOnWindowFocus: 'always',
    },
  },
});

function InitialLayout() {
  const { session, isLoading, setSession, setIsLoading, setProfile } = useAuthStore();
  const [isReady, setIsReady] = useState(false);
  // Plan id from a tapped push, held until the navigator can take us there.
  const [pushedPlanId, setPushedPlanId] = useState<string | null>(null);
  const router = useRouter();
  const navReady = !!useRootNavigationState()?.key;

  useEffect(() => {
    let isMounted = true;

    async function syncProfile(userId: string) {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) {
        throw error;
      }

      if (isMounted) {
        setProfile(data);
      }
    }

    async function initialize() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!isMounted) return;

        setSession(session);
        if (session?.user) {
          await syncProfile(session.user.id);
          void registerPushToken(session.user.id);
        } else {
          setProfile(null);
        }
      } catch (error) {
        console.error(
          'Failed to initialize Supabase session. Check EXPO_PUBLIC_SUPABASE_URL and that the host is reachable from the simulator.',
          error
        );
        try {
          await supabase.auth.signOut({ scope: 'local' });
        } catch (signOutError) {
          console.error('Failed to clear the local Supabase session after initialization error.', signOutError);
        }
        if (isMounted) {
          setSession(null);
          setProfile(null);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
          setIsReady(true);
        }
      }
    }

    async function handleAuthStateChange(session: Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session']) {
      setSession(session);

      if (!session?.user) {
        setProfile(null);
        return;
      }

      try {
        await syncProfile(session.user.id);
        void registerPushToken(session.user.id);
      } catch (error) {
        console.error(
          'Failed to load Supabase profile after auth change. Check EXPO_PUBLIC_SUPABASE_URL and that the host is reachable from the simulator.',
          error
        );
        if (isMounted) {
          setProfile(null);
        }
      }
    }

    void initialize();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      void handleAuthStateChange(session);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    initNotificationPresentation();

    // Both the warm-tap listener and the cold-start check land in state; the
    // effect below navigates once auth and the navigator are ready.
    const grab = (response: Notifications.NotificationResponse | null) => {
      const planId = response?.notification.request.content.data?.plan_id;
      if (typeof planId === 'string') {
        setPushedPlanId(planId);
      }
    };
    void Notifications.getLastNotificationResponseAsync().then(grab);
    const subscription = Notifications.addNotificationResponseReceivedListener(grab);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!pushedPlanId || isLoading || !session || !navReady) return;
    setPushedPlanId(null);
    router.push(`/(app)/plan/${pushedPlanId}`);
  }, [pushedPlanId, isLoading, session, navReady, router]);

  if (!isReady || isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return <Slot />;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    BricolageGrotesque_700Bold,
    BricolageGrotesque_800ExtraBold,
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
    InstrumentSans_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="dark" />
      <InitialLayout />
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.white,
  },
});
