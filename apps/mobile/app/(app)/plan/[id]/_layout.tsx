import { Stack } from 'expo-router';
import { COLORS } from '../../../../constants/colors';

export default function PlanLayout() {
  return (
    <Stack
      screenOptions={{
        headerTintColor: COLORS.primary,
        headerBackTitle: 'Back',
      }}
    >
      <Stack.Screen name="index" />
    </Stack>
  );
}
