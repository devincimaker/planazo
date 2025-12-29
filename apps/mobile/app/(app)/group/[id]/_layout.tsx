import { Stack } from 'expo-router';
import { COLORS } from '../../../../constants/colors';

export default function GroupLayout() {
  return (
    <Stack
      screenOptions={{
        headerTintColor: COLORS.primary,
        headerBackTitle: 'Back',
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="members" options={{ title: 'Members' }} />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
    </Stack>
  );
}
