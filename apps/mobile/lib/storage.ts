import { supabase } from './supabase';

/**
 * Buckets that key their objects on an owner-id folder. Both hold something
 * personal: a face, and screenshots of whatever screen someone was looking at.
 */
const OWNED_BUCKETS = ['avatars', 'feedback-screenshots'] as const;

type OwnedBucket = (typeof OWNED_BUCKETS)[number];

/**
 * `list()` defaults to 100 rows and silently stops there. Somebody who has
 * filed a lot of feedback has more than that, and the files past the first
 * page were being left behind with nobody left to delete them.
 */
const PAGE_SIZE = 100;

export interface PurgeResult {
  /** Buckets still holding files afterwards. Empty means the purge is clean. */
  failed: OwnedBucket[];
}

/** Every object under `<userId>/` in a bucket, following pagination to the end. */
async function listAll(bucket: OwnedBucket, userId: string): Promise<string[]> {
  const paths: string[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(userId, { limit: PAGE_SIZE, offset });

    if (error) throw error;
    if (!data?.length) break;

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
    OWNED_BUCKETS.map(async (bucket) => {
      try {
        const paths = await listAll(bucket, userId);

        for (let i = 0; i < paths.length; i += PAGE_SIZE) {
          const { error } = await supabase.storage
            .from(bucket)
            .remove(paths.slice(i, i + PAGE_SIZE));
          if (error) throw error;
        }

        const left = await listAll(bucket, userId);
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

  return { failed: outcomes.filter((bucket): bucket is OwnedBucket => bucket !== null) };
}
