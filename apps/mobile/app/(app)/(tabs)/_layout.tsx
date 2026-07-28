import { Tabs } from 'expo-router';
import { TabBar } from '../../../components/navigation/TabBar';

export default function TabsLayout() {
  return (
    <Tabs tabBar={(props) => <TabBar {...(props as any)} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" />
      {/* Keeps the stock header until the Groups slice rebuilds this screen */}
      <Tabs.Screen name="groups" options={{ headerShown: true, title: 'Groups' }} />
    </Tabs>
  );
}
