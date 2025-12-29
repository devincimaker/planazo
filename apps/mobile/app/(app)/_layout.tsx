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
      <Stack.Screen name="group/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="plan/create" options={{ title: 'Create Plan', presentation: 'modal' }} />
      <Stack.Screen name="plan/[id]" options={{ headerShown: false }} />
    </Stack>
  );
}
