import { useEffect } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Touch-target padding for a text link.
 *
 * Apple's HIG asks for 44×44pt. A caption is about 35×17 and a `sub` link
 * about 90×20, so the widths are fine once you account for the word but the
 * heights are not — hence the generous vertical figure. hitSlop grows the
 * touchable area without moving a single pixel of layout, which is the only
 * reason these screens can hit 44pt and still match the design.
 */
export const LINK_HIT_SLOP = { top: 14, bottom: 14, left: 12, right: 12 } as const;

/**
 * Speak a message the moment it appears.
 *
 * The auth screens replaced native `Alert`s with inline error boxes, which
 * look better and say nothing: VoiceOver does not announce a View that
 * quietly appears mid-screen, so a blind user tapped "Sign in" and got
 * silence. `accessibilityRole="alert"` alone is unreliable on iOS for
 * already-mounted trees, so announce it explicitly as well.
 */
export function useAnnounce(message: string | null | undefined): void {
  useEffect(() => {
    if (message) {
      AccessibilityInfo.announceForAccessibility(message);
    }
  }, [message]);
}
