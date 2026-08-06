import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../stores/authStore';
import { useNeedsOnboarding } from '../lib/useOnboarding';
import { takePendingJoin } from '../lib/pendingJoin';
import { BrandSplash } from '../components/ui';

/**
 * The one place that decides where a launch lands.
 *
 * Every door into the app comes through here — cold start, sign-in, sign-up,
 * password reset — so the first-run gate (PLA-75) is written once rather than
 * copied into each of them, where it would drift.
 */
export default function Index() {
  const router = useRouter();
  const { session } = useAuthStore();
  const needsOnboarding = useNeedsOnboarding();

  useEffect(() => {
    // Small delay to ensure navigation is ready
    const timer = setTimeout(() => {
      if (!session) {
        router.replace('/(auth)/login');
        return;
      }

      // An invite that sent someone to sign up is waiting to be finished
      // (PLA-77), and it outranks the carousel: they tapped a particular
      // group, and answering that is what they came to do. Nothing is lost,
      // because `onboarded_at` is still null and the next launch comes back
      // through here to tell them what Planazo is for.
      const pendingJoin = takePendingJoin();
      if (pendingJoin) {
        router.replace(`/(app)/join/${pendingJoin}`);
      } else if (needsOnboarding) {
        router.replace('/onboarding');
      } else {
        router.replace('/(app)/(tabs)');
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [session, needsOnboarding, router]);

  return <BrandSplash />;
}
