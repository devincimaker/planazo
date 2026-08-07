import { Stack } from 'expo-router';

export default function GroupLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="manage" />
      <Stack.Screen name="admins" />
      <Stack.Screen name="edit" options={{ presentation: 'modal' }} />
      <Stack.Screen
        name="invite"
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: [0.75],
          sheetCornerRadius: 30,
        }}
      />
    </Stack>
  );
}
