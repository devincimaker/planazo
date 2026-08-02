import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../stores/authStore';
import { BrandSplash } from '../components/ui';

export default function Index() {
  const router = useRouter();
  const { session } = useAuthStore();

  useEffect(() => {
    // Small delay to ensure navigation is ready
    const timer = setTimeout(() => {
      if (session) {
        router.replace('/(app)/(tabs)');
      } else {
        router.replace('/(auth)/login');
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [session]);

  return <BrandSplash />;
}
