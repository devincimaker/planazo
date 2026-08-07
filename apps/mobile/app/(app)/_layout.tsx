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
        <Stack.Screen
          name="profile/blocked"
          options={{ presentation: 'modal', headerShown: false }}
        />
        <Stack.Screen name="group/[id]" options={{ headerShown: false }} />
        {/* Where an invite link lands (PLA-77). No header: it can be the first
            screen of a cold launch, and "Back" would point at nothing. */}
        <Stack.Screen name="join/[code]" options={{ headerShown: false }} />
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
        {/* An interruption rather than a destination (PLA-68): the feed stays
            visible behind it, so a short detent is the whole point. */}
        <Stack.Screen
          name="plan/needs-group"
          options={{
            presentation: 'formSheet',
            headerShown: false,
            sheetAllowedDetents: [sheetDetents.needsGroup],
            sheetCornerRadius: 30,
            // There is no header to hint at dragging, and the sheet is meant
            // to feel dismissable rather than answered.
            sheetGrabberVisible: true,
          }}
        />
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
