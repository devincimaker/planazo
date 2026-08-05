import { useCallback, useEffect, useRef, useState } from 'react';
import { Slot, useRouter, useRootNavigationState } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet, AppState, AppStateStatus } from 'react-native';
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
import * as Sentry from '@sentry/react-native';
import { supabase } from '../lib/supabase';
import { signOutOfAccount } from '../lib/signOut';
import { initNotificationPresentation, registerPushToken } from '../lib/push';
import { initSentry, captureError } from '../lib/sentry';
import { errorCopy, isInvalidSessionError, isOfflineError, retryQuery } from '../lib/queryErrors';
import { BrandSplash } from '../components/ui';
import { ErrorState } from '../components/ui/ErrorState';
import { useAuthStore } from '../stores/authStore';
import { colors } from '../theme/tokens';

// Before anything else in the app can run and throw.
initSentry();

// Fire-and-forget, as in Expo's own examples: it rejects only when the splash
// is already gone, which is the outcome being asked for anyway.
void SplashScreen.preventAutoHideAsync();

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
  /** A sign-out whose credentials would not delete — never report that as done. */
  const [signOutFailed, setSignOutFailed] = useState(false);
  /** Held until the navigator exists to take us to the login screen. */
  const [leavingForLogin, setLeavingForLogin] = useState(false);
  // Plan id from a tapped push, held until the navigator can take us there.
  const [pushedPlanId, setPushedPlanId] = useState<string | null>(null);
  const router = useRouter();
  // expo-router types the state as always present, but it delegates to
  // react-navigation's getState(), which is undefined until the navigator
  // mounts. That window is what navReady exists to bridge.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
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
   * The same sign-out the profile sheet performs — push token, server, storage,
   * memory — so a session ended from the recovery screen is ended just as
   * thoroughly as one ended from inside the app.
   */
  const endSession = useCallback(async () => {
    const signedOut = await signOutOfAccount(useAuthStore.getState().user?.id, queryClient);
    if (!isMounted.current) return;

    if (!signedOut) {
      // The credentials are still on disk. Showing the login screen here would
      // be a lie that the next launch exposes.
      setSignOutFailed(true);
      return;
    }

    setSignOutFailed(false);
    setInitError(null);
    setLeavingForLogin(true);
  }, []);

  const initialize = useCallback(async () => {
    setInitError(null);
    setSignOutFailed(false);
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

      captureError(error, 'Supabase has already dropped the stored session; finishing the sign-out.');
      await endSession();
    } finally {
      if (isMounted.current) {
        setIsLoading(false);
        setIsReady(true);
      }
    }
  }, [endSession, setIsLoading, setProfile, setSession, syncProfile]);

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
        captureError(
          error,
          'Failed to load Supabase profile after auth change. Check EXPO_PUBLIC_SUPABASE_URL and that the host is reachable from the simulator.'
        );
        if (isMounted.current) {
          setProfile(null);
        }
      }
    },
    [setProfile, setSession, syncProfile]
  );

  useEffect(() => {
    // Bootstrapping auth is exactly the case the rule warns about and the one
    // it cannot help with: the first load has to land in state, and it happens
    // once on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
      const planId = response?.notification.request.content.data.plan_id;
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
    // Consuming a one-shot intent: clearing it is what stops the navigation
    // firing twice, so the write is the point rather than a cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPushedPlanId(null);
    router.push(`/(app)/plan/${pushedPlanId}`);
  }, [pushedPlanId, isLoading, session, navReady, router]);

  // Signing out has to say where to go. (app)/_layout has no session guard, so
  // a cold deep link into a plan would otherwise still be sitting there behind
  // the recovery screen we just dismissed. Waits for the navigator, which only
  // mounts once we stop rendering the error state in its place.
  useEffect(() => {
    if (!leavingForLogin || !navReady) return;
    // Same one-shot consume as the push intent above.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLeavingForLogin(false);
    router.replace('/(auth)/login');
  }, [leavingForLogin, navReady, router]);

  if (!isReady || isLoading) {
    return <BrandSplash />;
  }

  // Takes precedence over initError: the sign-out was the user's last
  // instruction, and it is the one that didn't happen.
  if (signOutFailed) {
    return (
      <View style={styles.error}>
        <ErrorState
          title="Couldn't sign out"
          body="Your account is still signed in on this device. Check your connection and try again."
          onRetry={() => void endSession()}
          testID="sign-out-error"
        />
      </View>
    );
  }

  if (initError) {
    return (
      <View style={styles.error}>
        <ErrorState
          {...errorCopy(initError)}
          onRetry={() => void initialize()}
          // Offline there is nothing behind this screen to get back to: a
          // sign-out would stall on /logout only to land them on a login screen
          // they can't use either. Anything else (a profile row that won't load)
          // needs a way out that isn't relaunching the app.
          onBack={isOfflineError(initError) ? undefined : () => void endSession()}
          backLabel="Sign out"
          testID="init-error"
        />
      </View>
    );
  }

  return <Slot />;
}

/**
 * Last resort for a render crash: the error is already in Sentry (the
 * boundary reports it), so all that's left is giving the user a way back
 * that isn't force-quitting a white screen.
 */
function CrashFallback({ resetError }: { resetError: () => void }) {
  return (
    <View style={styles.error}>
      <ErrorState
        title="Something went wrong"
        body="The app hit a problem it couldn't recover from. Try again, and if this keeps happening, close and reopen the app."
        onRetry={resetError}
        testID="crash-fallback"
      />
    </View>
  );
}

function RootLayout() {
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
      // Same contract as preventAutoHideAsync above: already-hidden is fine.
      void SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <Sentry.ErrorBoundary fallback={({ resetError }) => <CrashFallback resetError={resetError} />}>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="dark" />
        <InitialLayout />
      </QueryClientProvider>
    </Sentry.ErrorBoundary>
  );
}

export default Sentry.wrap(RootLayout);

const styles = StyleSheet.create({
  error: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
});
