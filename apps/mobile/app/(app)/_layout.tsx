import { Stack } from 'expo-router';
import { colors, sheetDetents } from '../../theme/tokens';
import { ToastHost } from '../../components/ui';
import { ScreenshotFeedback } from '../../components/ScreenshotFeedback';
import { useRealtimeCacheSync } from '../../lib/realtime';

// A component rather than a call in AppLayout: the hook subscribes to auth
// state, and nothing visual here should re-render with it.
function RealtimeCacheSync() {
  useRealtimeCacheSync();
  return null;
}

export default function AppLayout() {
  return (
    <>
      <Stack
        screenOptions={{
          headerTintColor: colors.accent,
          headerBackTitle: 'Back',
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="profile/index"
          options={{
            presentation: 'modal',
            headerShown: false,
          }}
        />
        <Stack.Screen name="profile/edit" options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="group/[id]" options={{ headerShown: false }} />
        <Stack.Screen
          name="group/new"
          getId={({ params }) => JSON.stringify(params ?? {})}
          options={{ presentation: 'modal', headerShown: false }}
        />
        <Stack.Screen
          name="invites"
          options={{
            presentation: 'formSheet',
            headerShown: false,
            sheetAllowedDetents: [sheetDetents.invites],
            sheetCornerRadius: 30,
          }}
        />
        <Stack.Screen name="find-people" options={{ headerShown: false }} />
        {/* getId: a deep link with different params mounts a fresh sheet instead
            of reusing a stale one (the params preseed sheet state in dev) */}
        <Stack.Screen
          name="plan/create"
          getId={({ params }) => JSON.stringify(params ?? {})}
          options={{ presentation: 'modal', headerShown: false }}
        />
        {/* getId: each screenshot carries a distinct shot param */}
        <Stack.Screen
          name="feedback"
          getId={({ params }) => JSON.stringify(params ?? {})}
          options={{ presentation: 'modal', headerShown: false }}
        />
        {/* getId: reporting a second thing must not reuse the first sheet's
            params, the same trap plan/create and feedback hit. */}
        <Stack.Screen
          name="report"
          getId={({ params }) => JSON.stringify(params ?? {})}
          options={{ presentation: 'modal', headerShown: false }}
        />
        <Stack.Screen name="plan/[id]" options={{ headerShown: false }} />
      </Stack>
      <RealtimeCacheSync />
      <ScreenshotFeedback />
      <ToastHost />
    </>
  );
}
