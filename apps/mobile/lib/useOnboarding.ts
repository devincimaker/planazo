import { useCallback } from 'react';
import { supabase } from './supabase';
import { useAuthStore } from '../stores/authStore';

/**
 * Whether this person still has to be told what the app is for (PLA-75).
 *
 * Reads the profile already in the store rather than fetching: `syncProfile` in
 * app/_layout.tsx loads the whole row before anything renders, so this is free
 * and never flashes the wrong screen.
 *
 * A missing profile answers `false`. The gate's job is deciding whether to
 * *interrupt* someone, and a row that hasn't loaded is not evidence they are
 * new — the launch path already has its own error state for that case.
 */
export function useNeedsOnboarding(): boolean {
  const profile = useAuthStore((s) => s.profile);
  return !!profile && profile.onboarded_at === null;
}

/**
 * Mark the carousel as seen, and stop it coming back.
 *
 * The store is updated whether or not the write lands. Someone who has just
 * read all four cards has been onboarded in every sense that matters to them,
 * and showing it again because the network blinked would be the worse failure.
 * The next successful profile sync repairs the flag if the write was lost.
 */
export function useFinishOnboarding(): () => Promise<void> {
  const profile = useAuthStore((s) => s.profile);
  const setProfile = useAuthStore((s) => s.setProfile);

  return useCallback(async () => {
    if (!profile) return;

    const onboardedAt = new Date().toISOString();
    setProfile({ ...profile, onboarded_at: onboardedAt });

    const { error } = await supabase
      .from('profiles')
      .update({ onboarded_at: onboardedAt })
      .eq('id', profile.id);

    if (error) {
      console.warn('Could not record that onboarding was seen.', error);
    }
  }, [profile, setProfile]);
}
