import { useCallback, useEffect, useRef, useState } from 'react';
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
import { errorCopy, isInvalidSessionError, isOfflineError, retryQuery } from '../lib/queryErrors';
import { ErrorState } from '../components/ui/ErrorState';
import { useAuthStore } from '../stores/authStore';
import { COLORS } from '../constants/colors';
import { colors } from '../theme/tokens';

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
  /** A launch failure the user can retry out of, instead of being signed out. */
  const [initError, setInitError] = useState<unknown>(null);
  // Plan id from a tapped push, held until the navigator can take us there.
  const [pushedPlanId, setPushedPlanId] = useState<string | null>(null);
  const router = useRouter();
  const navReady = !!useRootNavigationState()?.key;

  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const syncProfile = useCallback(
    async (userId: string) => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) {
        throw error;
      }

      if (isMounted.current) {
        setProfile(data);
      }
    },
    [setProfile]
  );

  /**
   * Local-only, so it never waits on a server that may not answer — and we only
   * ever reach it when the network has already proved it works.
   */
  const signOutLocally = useCallback(async () => {
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch (error) {
      console.error('Failed to clear the local Supabase session.', error);
    }
    if (!isMounted.current) return;
    setSession(null);
    setProfile(null);
    setInitError(null);
  }, [setProfile, setSession]);

  const initialize = useCallback(async () => {
    setInitError(null);
    setIsLoading(true);

    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (!isMounted.current) return;
      // getSession reports a failed refresh here rather than throwing, and hands
      // back a null session either way — so this error is the only thing that
      // separates "the wifi dropped" from "this token is dead" (PLA-36).
      if (error) throw error;

      setSession(session);
      if (session?.user) {
        await syncProfile(session.user.id);
        void registerPushToken(session.user.id).catch((error) => {
          console.warn('Could not register this device for push.', error);
        });
      } else {
        setProfile(null);
      }
    } catch (error) {
      if (!isMounted.current) return;

      // Only a token the server actually read and refused is worth destroying
      // the session over. A transport failure says nothing about it, and a
      // profile row that won't load is a data problem, not a credentials one —
      // both used to drop the user on the login screen to retype a password
      // over a three-second blip (PLA-36).
      if (!isInvalidSessionError(error)) {
        console.warn('Could not finish launching; keeping the stored session.', error);
        setInitError(error);
        return;
      }

      console.error('Supabase refused the stored session; signing out locally.', error);
      await signOutLocally();
    } finally {
      if (isMounted.current) {
        setIsLoading(false);
        setIsReady(true);
      }
    }
  }, [setIsLoading, setProfile, setSession, signOutLocally, syncProfile]);

  const handleAuthStateChange = useCallback(
    async (session: Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session']) => {
      setSession(session);

      if (!session?.user) {
        setProfile(null);
        setInitError(null);
        return;
      }

      try {
        await syncProfile(session.user.id);
        void registerPushToken(session.user.id).catch((error) => {
          console.warn('Could not register this device for push.', error);
        });
        if (isMounted.current) {
          // Whatever failed at launch has since worked, so the retry screen has
          // nothing left to offer.
          setInitError(null);
        }
      } catch (error) {
        console.error(
          'Failed to load Supabase profile after auth change. Check EXPO_PUBLIC_SUPABASE_URL and that the host is reachable from the simulator.',
          error
        );
        if (isMounted.current) {
          setProfile(null);
        }
      }
    },
    [setProfile, setSession, syncProfile]
  );

  useEffect(() => {
    void initialize();
    // Retries call initialize() directly; re-running it on every render would
    // refetch the profile for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // initialize() owns the first load. INITIAL_SESSION duplicates it, and
      // arrives as a bare null when the token refresh failed on the network —
      // which would sign the user out behind initialize's back (PLA-36).
      if (event === 'INITIAL_SESSION') return;
      void handleAuthStateChange(session);
    });

    return () => subscription.unsubscribe();
  }, [handleAuthStateChange]);

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

  if (initError) {
    return (
      <View style={styles.error}>
        <ErrorState
          {...errorCopy(initError)}
          onRetry={() => void initialize()}
          // Offline there is nothing behind this screen to get back to, and the
          // sign-out couldn't reach the server to stick anyway — retrying is the
          // only move that helps. Anything else (a profile row that won't load)
          // needs a way out that isn't relaunching the app.
          onBack={isOfflineError(initError) ? undefined : () => void signOutLocally()}
          backLabel="Sign out"
          testID="init-error"
        />
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
  error: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
});
