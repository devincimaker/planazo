import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from './supabase';
import { pickManyFromLibrary, uploadJpeg, type PickedImage } from './images';
import { isForbiddenError } from './queryErrors';
import { spellCount } from './words';

export const PHOTO_BUCKET = 'plan-photos';

/** Mirrors the caps enforced by enforce_photo_caps() in 20260803000001. The
 *  database is the one that decides; these are here so the UI can say "full"
 *  without spending a round trip to be told. */
export const MAX_PHOTOS_PER_PLAN = 200;
export const MAX_PHOTOS_PER_PERSON = 20;

/** Longest edge, in pixels, that we keep. A 12MP phone photo is 4032 across
 *  and lands around 2.5MB even at quality 0.7, and storage is the heaviest
 *  thing this product would ever hold. 2048 still fills a Pro Max screen at
 *  2x and costs about a fifth as much. */
const MAX_EDGE = 2048;
const QUALITY = 0.72;

/** Longest edge of the tile rendition written alongside every upload (PLA-56).
 *  The card strip draws at ~85pt and the album grid at ~120pt; 512 covers
 *  both at 3x with room for wider tiles later, and lands around 30-50KB where
 *  the original is ~500KB. Tiles draw this; only the full-screen viewer pays
 *  for the 2048. */
const THUMB_EDGE = 512;

/** How long a signed URL lasts. Long enough to browse an album without
 *  re-signing mid-scroll, short enough that a link someone screenshots out of
 *  a debugger is dead by the time it travels. The query that holds them keeps
 *  a staleTime derived from this. */
export const SIGNED_URL_TTL_SECONDS = 3600;

export interface PlanPhoto {
  id: string;
  plan_id: string;
  uploaded_by: string;
  storage_path: string;
  /** The ~512px rendition, when one exists. NULL means fall back to the
   *  original: photos from before thumbnails, or sources already small. */
  thumb_path: string | null;
  width: number | null;
  height: number | null;
  created_at: string;
}

/** A row with the display name of whoever took it. */
export interface PhotoRow extends PlanPhoto {
  uploader: { display_name: string } | null;
}

export interface SignedPhoto extends PhotoRow {
  /** The full-size original. What the viewer shows. */
  url: string;
  /** What a tile shows: the rendition when the row has one and its object
   *  signed, otherwise the original. Always present so a caller never
   *  re-derives the fallback. */
  thumbUrl: string;
}

/** Selected by both the plan-detail card and the album screen. The FK hint is
 *  a string the compiler cannot check, which is reason enough for it to exist
 *  exactly once. */
export const PHOTO_SELECT =
  'id, plan_id, uploaded_by, storage_path, thumb_path, width, height, created_at, uploader:profiles!plan_photos_uploaded_by_fkey(display_name)';

/**
 * Path for a new photo: `<plan>/<uploader>/<key>.jpg`.
 *
 * The first two segments are what the storage policies read to decide who may
 * write and who may look, so they are structural rather than decorative. The
 * key only has to be unique, and `storage_path` carries a UNIQUE constraint
 * that turns a collision into a failed insert instead of one photo silently
 * overwriting another. There is no crypto RNG in this app's dependency set and
 * this is not a secret: the bucket is private and RLS, not obscurity, is what
 * keeps the file unreadable.
 */
function photoKey(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Up to `limit` photos from the library, with their dimensions. */
export function pickPhotos(limit: number): Promise<PickedImage[]> {
  return pickManyFromLibrary(limit);
}

/** Downscale to a longest edge and re-encode. The one place the resize and
 *  encode rules (orientation handling, quality, format) live; both the stored
 *  original and the tile rendition are cut by it. */
async function downscaleToEdge(photo: PickedImage, edge: number): Promise<PickedImage> {
  const resize = photo.width >= photo.height ? { width: edge } : { height: edge };
  const out = await ImageManipulator.manipulateAsync(photo.uri, [{ resize }], {
    compress: QUALITY,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  return { uri: out.uri, width: out.width, height: out.height };
}

/**
 * Downscale and re-encode one photo before it costs anything to store.
 *
 * `quality` on the picker compresses but never resizes, so the full sensor
 * resolution survives into the bucket. This is the step that makes an album
 * affordable, and it runs before upload so a flaky connection is carrying
 * 500KB rather than 2.5MB.
 *
 * Returns the original when it is already small enough, so the caller has to
 * know whether it owns the file it got back before deleting it.
 */
async function preparePhoto(photo: PickedImage): Promise<{ photo: PickedImage; temp: boolean }> {
  const longest = Math.max(photo.width, photo.height);
  if (!longest || longest <= MAX_EDGE) {
    // Already small. Re-encoding would cost quality for nothing.
    return { photo, temp: false };
  }

  return { photo: await downscaleToEdge(photo, MAX_EDGE), temp: true };
}

export interface UploadOutcome {
  /** Photos that made it all the way to a row plus an object. */
  added: number;
  /** Photos that did not, for a reason that trying again might fix. */
  failed: number;
  /**
   * The batch was never allowed (PLA-55). A different thing from a failure:
   * no amount of retrying turns a refusal into a photo, so the card must not
   * offer one.
   */
  refused: boolean;
}

/**
 * Add photos to a plan, one at a time, reporting progress as it goes.
 *
 * **The row goes in before the bytes do**, which is the opposite of the
 * obvious order and deliberate. Two reasons:
 *
 *   1. The caps live in a trigger on the row. Inserting first means someone
 *      who is already at their limit finds out immediately, rather than after
 *      their phone has pushed eight megabytes over a hotel wifi.
 *   2. `plan_photos` is the index of what exists in the bucket, and it is what
 *      the account purge reads to find someone's files. An object written
 *      before its row and then orphaned by a crash would be invisible,
 *      unpurgeable, and billable forever. A row orphaned the other way is
 *      visible, and its owner can delete it.
 *
 * Sequential rather than parallel: a half-finished batch on a bad connection
 * should stop having spent as little as possible, and eight concurrent
 * uploads on a phone tend to make each other time out.
 */
export async function uploadPhotos(opts: {
  planId: string;
  userId: string;
  photos: PickedImage[];
  onProgress?: (done: number, total: number) => void;
}): Promise<UploadOutcome> {
  const { planId, userId, photos, onProgress } = opts;
  let added = 0;
  let failed = 0;
  let refused = false;

  for (const [index, picked] of photos.entries()) {
    let insertedId: string | null = null;
    const scratch: string[] = [];
    let uploadedThumb: string | null = null;
    try {
      const { photo: prepared, temp } = await preparePhoto(picked);
      if (temp) scratch.push(prepared.uri);

      const key = photoKey();
      const path = `${planId}/${userId}/${key}.jpg`;

      // The rendition is cut from the already-prepared image rather than the
      // full sensor original: identical pixels at tile size, and a ~3MP
      // decode instead of ~12. None when the prepared image is already
      // tile-sized; the NULL lands in thumb_path, where the read side knows
      // to fall back to the original.
      let thumb: { uri: string; path: string } | null = null;
      if (Math.max(prepared.width, prepared.height) > THUMB_EDGE) {
        const out = await downscaleToEdge(prepared, THUMB_EDGE);
        scratch.push(out.uri);
        thumb = { uri: out.uri, path: `${planId}/${userId}/${key}_thumb.jpg` };
      }

      const { data: row, error: insertError } = await supabase
        .from('plan_photos')
        .insert({
          plan_id: planId,
          uploaded_by: userId,
          storage_path: path,
          thumb_path: thumb?.path ?? null,
          width: prepared.width,
          height: prepared.height,
        })
        .select('id')
        .single();

      if (insertError) {
        // The trigger raises these two by name. A full album is not something
        // the person can fix by retrying, so stop rather than fail 19 more.
        if (/photo_cap_reached/.test(insertError.message)) break;
        // Nor is a refusal. RLS answering 42501 means this person was never
        // in the plan, so the other nineteen would be refused identically
        // (PLA-55). Stop, and say so rather than counting it as a failure.
        if (isForbiddenError(insertError)) {
          refused = true;
          break;
        }
        throw insertError;
      }
      insertedId = row.id;

      // Thumb first: the pair is all-or-nothing (there is no UPDATE policy to
      // null a thumb_path later), so on a connection that is going to die,
      // dying after 30KB beats dying after 500.
      if (thumb) {
        await uploadJpeg({ bucket: PHOTO_BUCKET, path: thumb.path, uri: thumb.uri });
        uploadedThumb = thumb.path;
      }
      await uploadJpeg({ bucket: PHOTO_BUCKET, path, uri: prepared.uri });

      added += 1;
      insertedId = null;
      uploadedThumb = null;
    } catch (error) {
      console.error('Photo upload failed', error);
      failed += 1;

      // Roll the row back so the grid never shows a tile with nothing behind
      // it, and take a thumb that made it up before the original failed: with
      // its row gone the object would be invisible to the account purge, which
      // reads paths out of rows. Best-effort, object first — while the row
      // still exists a leftover object is at least findable.
      if (uploadedThumb) {
        await supabase.storage
          .from(PHOTO_BUCKET)
          .remove([uploadedThumb])
          .catch(() => {});
      }
      if (insertedId) {
        await supabase.from('plan_photos').delete().eq('id', insertedId);
      }
    } finally {
      // The manipulator writes every resize into the cache directory and
      // nothing else ever collects them, so a 20-photo batch leaves 10MB
      // behind. Only ours to delete: an untouched photo's uri is the user's
      // own file in the photo library.
      for (const uri of scratch) {
        await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      }
      onProgress?.(index + 1, photos.length);
    }
  }

  return { added, failed, refused };
}

/**
 * Signed URLs already minted, by path (PLA-56).
 *
 * Without this, any change to an album re-signed every path, and because each
 * signature carries a fresh token, every mounted Image got a new `uri` and
 * re-downloaded a tile that had not changed. Held here rather than in the
 * query cache precisely so that query keys coming and going cannot rotate a
 * URL that is still good: as long as a path's entry is fresh, every caller
 * gets the byte-identical string and iOS's URL cache keeps doing its job.
 *
 * Bounded by what the person actually looks at (an entry is ~300 bytes, a
 * full 200-photo album ~120KB), and dropped wholesale on sign-out. Entries
 * for photos that get deleted linger until expiry, harmlessly: their rows are
 * gone, so nothing asks for them again.
 */
const signedUrlCache = new Map<string, { url: string; expiresAtMs: number }>();

/** Re-sign a held URL once less than half its life remains, so what we hand
 *  out is always good for a comfortable browse. Exported because the signed
 *  queries in usePlanPhotos.ts use it as their staleTime: they can only ever
 *  serve fresher than the cache refreshes, and the two numbers moving apart
 *  would quietly reintroduce the double-signing this file exists to kill. */
export const SIGNED_URL_REFRESH_MS = (SIGNED_URL_TTL_SECONDS * 1000) / 2;

/** The storage objects behind one photo: the original, plus the rendition
 *  when it has one. Signing, delete and the account purge all enumerate
 *  through this, so a future second rendition is one edit here rather than a
 *  hunt for every place that spells the pair out. */
function photoObjectPaths(p: Pick<PlanPhoto, 'storage_path' | 'thumb_path'>): string[] {
  return p.thumb_path ? [p.storage_path, p.thumb_path] : [p.storage_path];
}

/** The other half of `queryClient.clear()` in signOut.ts: the next account on
 *  this device starts with no URLs minted for the last one. */
export function clearSignedUrlCache(): void {
  signedUrlCache.clear();
}

/** A held URL that is still alive, evicting on the way out. Without the
 *  eviction, a path whose object is gone would serve its dead URL forever:
 *  re-signing it fails quietly (the signer just omits it), so expiry is the
 *  only exit. */
function heldUrl(path: string, now: number): string | undefined {
  const held = signedUrlCache.get(path);
  if (!held) return undefined;
  if (held.expiresAtMs <= now) {
    signedUrlCache.delete(path);
    return undefined;
  }
  return held.url;
}

/**
 * Turn rows into displayable photos.
 *
 * A private bucket has no equivalent of `getPublicUrl`, so every render needs
 * signatures. `createSignedUrls` takes the whole batch in one request, which
 * is the difference between one round trip per album and one per tile — and
 * only paths the cache does not hold are in the batch at all, so one new
 * photo costs one signature, not two hundred.
 *
 * Rows whose object has gone missing are dropped rather than rendered as a
 * broken tile: the signer reports per-path errors, and a photo we cannot show
 * is better absent than grey.
 */
export async function signPhotos<T extends { storage_path: string; thumb_path: string | null }>(
  photos: T[],
): Promise<(T & { url: string; thumbUrl: string })[]> {
  if (!photos.length) return [];

  // Originals and renditions in the same request: 2N paths is still one round
  // trip, and the response is a few hundred bytes per path against the 450KB
  // a tile saves by drawing the rendition instead of the original.
  const wanted = photos.flatMap(photoObjectPaths);

  const now = Date.now();
  const missing = wanted.filter((path) => {
    const held = signedUrlCache.get(path);
    return !held || held.expiresAtMs - now < SIGNED_URL_REFRESH_MS;
  });

  if (missing.length) {
    const { data, error } = await supabase.storage
      .from(PHOTO_BUCKET)
      .createSignedUrls(missing, SIGNED_URL_TTL_SECONDS);
    if (error) throw error;

    const expiresAtMs = now + SIGNED_URL_TTL_SECONDS * 1000;
    for (const entry of data) {
      if (!entry.signedUrl || entry.error || !entry.path) continue;
      // First write wins. A concurrent caller (the card and the album screen
      // are mounted together) may have filled this path while our request was
      // in flight; overwriting would hand the two of them different strings
      // for the same tile, which is the re-download this cache exists to
      // prevent. Only an absent or stale entry is replaced.
      const held = signedUrlCache.get(entry.path);
      if (held && held.expiresAtMs - now >= SIGNED_URL_REFRESH_MS) continue;
      signedUrlCache.set(entry.path, { url: entry.signedUrl, expiresAtMs });
    }
  }

  // A missing original drops the photo; a missing rendition only falls back
  // to the original, so a half-deleted pair degrades instead of vanishing.
  return photos.flatMap((p) => {
    const url = heldUrl(p.storage_path, now);
    if (!url) return [];
    const thumbUrl = (p.thumb_path && heldUrl(p.thumb_path, now)) || url;
    return [{ ...p, url, thumbUrl }];
  });
}

/**
 * Remove one photo, object first.
 *
 * The reverse of the upload order, and for the same reason: the row is the
 * only record of where the object lives, so deleting it first would strand
 * the file. If the object delete fails, the row stays and the person can try
 * again; if it succeeds and the row delete fails, the next signing pass drops
 * the tile anyway.
 */
export async function deletePhoto(photo: PlanPhoto): Promise<void> {
  const { error: objectError } = await supabase.storage
    .from(PHOTO_BUCKET)
    .remove(photoObjectPaths(photo));
  if (objectError) throw objectError;

  const { error: rowError } = await supabase.from('plan_photos').delete().eq('id', photo.id);
  if (rowError) throw rowError;
}

/**
 * Every object this person has put in an album, by exact path.
 *
 * `purgeOwnedFiles` in lib/storage.ts works by listing `<userId>/` in buckets
 * keyed by owner. This bucket is keyed by *plan*, because that is what the
 * storage policies read to decide who may look, so there is no folder to
 * list. The rows are the index instead, which is the other half of why
 * uploads write them first.
 */
export async function listOwnedPhotoPaths(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('plan_photos')
    .select('storage_path, thumb_path')
    .eq('uploaded_by', userId);
  if (error) throw error;
  return data.flatMap(photoObjectPaths);
}

/**
 * How an album describes itself: "One photo, from Lucía", "12 photos from
 * Alex", "35 photos from five people".
 *
 * One function because the card and the album screen say the same sentence,
 * and when they each had their own the screen ended up rendering
 * "1 photos from Lucía". Takes counts rather than rows because the card gets
 * its numbers from `plan_album_card` without ever holding the rows; the album
 * screen, which does hold them, adapts through {@link albumSummaryFromRows}.
 */
export function albumSummary(album: {
  total: number;
  uploaders: number;
  /** Whoever uploaded the newest photo. */
  name?: string | null;
}): string {
  const { total, uploaders, name } = album;
  if (!total) return '';

  if (total === 1) return name ? `One photo, from ${name}` : 'One photo';
  if (uploaders === 1) return name ? `${total} photos from ${name}` : `${total} photos`;
  return `${total} photos from ${spellCount(uploaders)} people`;
}

/** The same sentence, from rows ordered newest first. */
export function albumSummaryFromRows(rows: Pick<PhotoRow, 'uploaded_by' | 'uploader'>[]): string {
  return albumSummary({
    total: rows.length,
    uploaders: new Set(rows.map((r) => r.uploaded_by)).size,
    name: rows[0]?.uploader?.display_name,
  });
}
