import { supabase } from './supabase';
import { PHOTO_BUCKET, listOwnedPhotoPaths } from './photos';

/**
 * Every bucket holding something that belongs to one person, and how to find
 * their files in it.
 *
 * `avatars` and `feedback-screenshots` key objects on an owner-id folder, so
 * listing that folder is the answer. `plan-photos` cannot: it is keyed by
 * *plan*, because that is what the storage policies read to decide who may
 * look, so there is no folder to list and the `plan_photos` rows are the
 * index instead. A per-bucket lister is what lets one purge cover both
 * shapes rather than growing a special case per bucket.
 */
interface PurgeTarget {
  bucket: string;
  /** This user's objects still present in the bucket. */
  remaining: (userId: string) => Promise<string[]>;
}

const PURGE_TARGETS: PurgeTarget[] = [
  { bucket: 'avatars', remaining: (userId) => listAll('avatars', userId) },
  {
    bucket: 'feedback-screenshots',
    remaining: (userId) => listAll('feedback-screenshots', userId),
  },
  {
    bucket: PHOTO_BUCKET,
    // The rows name every path; signing says which of them is still an
    // object. Re-reading the rows alone would report failure forever, since
    // removing an object leaves its row untouched until the account cascade.
    remaining: async (userId) => stillPresent(PHOTO_BUCKET, await listOwnedPhotoPaths(userId)),
  },
];

/**
 * `list()` defaults to 100 rows and silently stops there. Somebody who has
 * filed a lot of feedback has more than that, and the files past the first
 * page were being left behind with nobody left to delete them.
 */
const PAGE_SIZE = 100;

export interface PurgeResult {
  /** Buckets still holding files afterwards. Empty means the purge is clean. */
  failed: string[];
}

/**
 * Which of these paths still exist. `createSignedUrls` reports per path, and
 * it signs only what is there, so a path that comes back signed is a file
 * that survived the remove.
 */
async function stillPresent(bucket: string, paths: string[]): Promise<string[]> {
  if (!paths.length) return [];
  const { data, error } = await supabase.storage.from(bucket).createSignedUrls(paths, 60);
  if (error) throw error;
  return data
    .filter((entry) => entry.signedUrl && !entry.error && entry.path)
    .map((entry) => entry.path as string);
}

/** Every object under `<userId>/` in a bucket, following pagination to the end. */
async function listAll(bucket: string, userId: string): Promise<string[]> {
  const paths: string[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(userId, { limit: PAGE_SIZE, offset });

    if (error) throw error;
    if (!data.length) break;

    paths.push(...data.map((file) => `${userId}/${file.name}`));
    if (data.length < PAGE_SIZE) break;
  }

  return paths;
}

/**
 * Empty this user's folder in every bucket that holds their files, and check
 * afterwards that it worked.
 *
 * Deleting the account does not do this by itself. Storage objects are not
 * rows that hang off auth.users, and Supabase guards storage.objects with a
 * protect_delete() trigger that raises on any direct DELETE — SECURITY
 * DEFINER included — so the database cannot reach them. The Storage API is
 * the only route, which means it has to happen here, while the caller is
 * still signed in and RLS still recognises them as the owner.
 *
 * It matters most for `avatars`, which is a **public** bucket: a file left
 * there stays fetchable by URL forever, by anyone, with no account left that
 * could remove it. That is the one outcome worth refusing to delete over, so
 * this reports what it could not clear rather than swallowing it, and the
 * caller stops. Re-listing at the end is the point — `remove()` can come back
 * without an error having deleted nothing at all when a policy blocks it, so
 * "no error" is not evidence the files are gone.
 */
export async function purgeOwnedFiles(userId: string): Promise<PurgeResult> {
  const outcomes = await Promise.all(
    PURGE_TARGETS.map(async ({ bucket, remaining }) => {
      try {
        const paths = await remaining(userId);

        for (let i = 0; i < paths.length; i += PAGE_SIZE) {
          const { error } = await supabase.storage
            .from(bucket)
            .remove(paths.slice(i, i + PAGE_SIZE));
          if (error) throw error;
        }

        const left = await remaining(userId);
        if (left.length) {
          console.error(`Purge left ${left.length} file(s) in ${bucket} for ${userId}`);
          return bucket;
        }
        return null;
      } catch (error) {
        console.error(`Failed to purge ${bucket} for ${userId}`, error);
        return bucket;
      }
    }),
  );

  return { failed: outcomes.filter((bucket): bucket is string => bucket !== null) };
}
