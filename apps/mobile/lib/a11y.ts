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
 * Apple's minimum touch target, in points (HIG: Buttons).
 *
 * Use it as `minHeight`/`minWidth` in a StyleSheet. Prefer making a control
 * genuinely this big over slopping around a small one: the padding that gets a
 * button to 44 usually already exists on its container, and moving it onto the
 * button means the area you can see is the area you can hit. That is how UIKit
 * does it — a navigation bar is 44pt tall precisely so a `UIBarButtonItem`
 * filling it clears the minimum without the words having to grow.
 *
 * `hitSlopTo` is the fallback for the cases where there is nothing to reclaim
 * and growing the box would cover something else.
 */
export const MIN_TOUCH_TARGET = 44;

/**
 * Slop that lifts a control of `size` points up to {@link MIN_TOUCH_TARGET} on
 * one axis — half the shortfall on each side, so the target stays centred on
 * the thing you can see. Already-big controls get 0 rather than a negative.
 *
 * Beware of neighbours: slop is invisible and unlike a real box it happily
 * overlaps the control next to it, and the one that wins a tap in the overlap
 * is not something you can see or reason about from the layout.
 */
export function hitSlopTo(size: number): number {
  return Math.max(0, Math.ceil((MIN_TOUCH_TARGET - size) / 2));
}

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
