import { Stack } from 'expo-router';

export default function GroupLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="manage" />
      <Stack.Screen name="edit" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
