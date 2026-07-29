import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import * as ScreenCapture from 'expo-screen-capture';
import { captureScreen } from 'react-native-view-shot';
import { feedbackSheetOpen } from '../lib/feedbackState';

/**
 * Feedback entry point 1 (user decision 2026-07-29): an OS screenshot while
 * the app is open opens the feedback sheet with that moment attached. iOS
 * only reports THAT a screenshot happened, never the image — so re-capture
 * the screen the instant the event fires: same pixels, no photo permission.
 */
export function ScreenshotFeedback() {
  const router = useRouter();

  useEffect(() => {
    const sub = ScreenCapture.addScreenshotListener(() => {
      if (feedbackSheetOpen.current) return;
      captureScreen({ format: 'jpg', quality: 0.85 })
        .then((uri) => router.push(`/(app)/feedback?shot=${encodeURIComponent(uri)}`))
        .catch(() => router.push('/(app)/feedback'));
    });
    return () => sub.remove();
  }, [router]);

  return null;
}
