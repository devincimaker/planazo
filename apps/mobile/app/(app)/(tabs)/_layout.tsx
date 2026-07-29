import { Tabs } from 'expo-router';
import { TabBar } from '../../../components/navigation/TabBar';

export default function TabsLayout() {
  return (
    <Tabs tabBar={(props) => <TabBar {...(props as any)} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="groups" />
    </Tabs>
  );
}
