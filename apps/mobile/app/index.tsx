import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../stores/authStore';
import { useNeedsOnboarding } from '../lib/useOnboarding';
import { takePendingJoin } from '../lib/pendingJoin';
import { takePendingPlan } from '../lib/pendingPlan';
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

      // A link that sent someone to sign in is waiting to be finished (PLA-77
      // for an invite, PLA-81 for a plan), and it outranks the carousel: they
      // tapped a particular group or plan, and answering that is what they came
      // to do. Nothing is lost, because `onboarded_at` is still null and the
      // next launch comes back through here to tell them what Planazo is for.
      //
      // Both are drained on every pass, so the one that loses cannot sit here
      // as a stale destination waiting for the next launch. An invite wins:
      // it is the one that grants access, and the plan behind a link is
      // usually in the very group the invite is for.
      const pendingJoin = takePendingJoin();
      const pendingPlan = takePendingPlan();
      if (pendingJoin) {
        router.replace(`/(app)/join/${pendingJoin}`);
      } else if (pendingPlan) {
        router.replace(`/(app)/plan/${pendingPlan}`);
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
