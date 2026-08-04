import type { QueryClient } from '@tanstack/react-query';
import { clearPushToken } from './push';
import { clearSignedUrlCache } from './photos';
import { forgetStoredSession, supabase } from './supabase';
import { useAuthStore } from '../stores/authStore';

/**
 * The one way out of an account, so the two places that offer it cannot drift
 * apart — the profile sheet, and the recovery screen at launch.
 *
 * The order is the point:
 *
 * 1. The push token goes first, while the session can still authenticate the
 *    write. Miss it and the old account keeps buzzing this device.
 * 2. Supabase is asked next, so the server still gets its chance to revoke.
 *    It reads the token back out of storage, so clearing ours first would
 *    quietly demote this to a local-only sign-out.
 * 3. Only once the credentials are actually gone from the device do we clear
 *    anything in memory. A login screen shown over a session still on disk is
 *    a lie the next launch exposes.
 *
 * Returns false when the credentials survived. Callers must stay put and say
 * so, rather than showing a login screen the user isn't really behind.
 */
export async function signOutOfAccount(
  userId: string | undefined,
  queryClient: QueryClient
): Promise<boolean> {
  try {
    if (userId) await clearPushToken(userId);
  } catch {
    // Best-effort: a device that keeps buzzing beats one that can't sign out.
  }

  try {
    await supabase.auth.signOut();
  } catch (error) {
    // Its own storage clearing is conditional on this call succeeding, which is
    // exactly why we never rely on it. Nothing to do here but carry on.
    console.warn('Supabase could not complete the sign-out.', error);
  }

  if (!(await forgetStoredSession())) return false;

  queryClient.clear();
  clearSignedUrlCache();
  useAuthStore.getState().logout();
  return true;
}
