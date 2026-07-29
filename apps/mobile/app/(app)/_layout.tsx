import { Stack } from 'expo-router';
import { COLORS } from '../../constants/colors';

export default function AppLayout() {
  return (
    <Stack
      screenOptions={{
        headerTintColor: COLORS.primary,
        headerBackTitle: 'Back',
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="profile" options={{ title: 'Profile' }} />
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
          sheetAllowedDetents: [0.78],
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
      <Stack.Screen name="plan/[id]" options={{ headerShown: false }} />
    </Stack>
  );
}
