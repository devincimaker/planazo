import { Stack } from 'expo-router';

export default function PlanLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen
        name="cancel"
        options={{
          presentation: 'formSheet',
          headerShown: false,
          sheetAllowedDetents: [0.72],
          sheetCornerRadius: 30,
        }}
      />
    </Stack>
  );
}
