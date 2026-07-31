import { supabase } from './supabase';

/**
 * Buckets that key their objects on an owner-id folder. Both hold something
 * personal: a face, and screenshots of whatever screen someone was looking at.
 */
const OWNED_BUCKETS = ['avatars', 'feedback-screenshots'] as const;

/**
 * Empty this user's folder in every bucket that holds their files.
 *
 * Deleting the account does not do this by itself. Storage objects are not
 * rows that hang off auth.users, and Supabase blocks direct DELETE against
 * storage.objects with a protect_delete() trigger — SECURITY DEFINER and all
 * — so the database cannot reach them. The Storage API is the only way, which
 * means it has to happen here, while the caller is still signed in and RLS
 * still recognises them as the owner.
 *
 * It matters most for `avatars`, which is a public bucket: without this the
 * profile photo stays fetchable by URL after the account is gone, which is
 * both an Apple requirement and something the privacy policy promises.
 *
 * Best effort by design. A storage hiccup must not strand somebody in an
 * account they asked to delete, so failures are reported and swallowed — the
 * rows that pointed at these files are about to disappear regardless.
 */
export async function purgeOwnedFiles(userId: string): Promise<void> {
  await Promise.all(
    OWNED_BUCKETS.map(async (bucket) => {
      try {
        const { data, error } = await supabase.storage.from(bucket).list(userId);
        if (error) throw error;
        if (!data?.length) return;

        const paths = data.map((file) => `${userId}/${file.name}`);
        const { error: removeError } = await supabase.storage.from(bucket).remove(paths);
        if (removeError) throw removeError;
      } catch (error) {
        console.error(`Failed to purge ${bucket} for ${userId}`, error);
      }
    }),
  );
}
