import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { supabase } from './supabase';

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

/** How long a signed URL lasts. Long enough to browse an album without
 *  re-signing mid-scroll, short enough that a link someone screenshots out of
 *  a debugger is dead by the time it travels. */
export const SIGNED_URL_TTL_SECONDS = 3600;

/** Re-sign this long before expiry rather than at it, so a slow image request
 *  started just under the wire still completes. */
const RESIGN_MARGIN_MS = 5 * 60 * 1000;

export interface PickedPhoto {
  uri: string;
  width: number;
  height: number;
}

export interface PlanPhoto {
  id: string;
  plan_id: string;
  uploaded_by: string;
  storage_path: string;
  width: number | null;
  height: number | null;
  created_at: string;
}

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

/**
 * Pick up to `limit` photos. Returns [] when the person cancels or declines
 * the permission, so callers never have to distinguish "said no" from "picked
 * nothing" — neither is an error and both mean the same thing here.
 */
export async function pickPhotos(limit: number): Promise<PickedPhoto[]> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    Alert.alert('Photos access needed', 'Allow photo access in Settings to add photos.');
    return [];
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: limit,
    quality: 1,
  });
  if (result.canceled) return [];

  return result.assets.map((a) => ({
    uri: a.uri,
    width: a.width ?? 0,
    height: a.height ?? 0,
  }));
}

/**
 * Downscale and re-encode one photo before it costs anything to store.
 *
 * `quality` on the picker compresses but never resizes, so the full sensor
 * resolution survives into the bucket. This is the step that makes an album
 * affordable, and it runs before upload so a flaky connection is carrying
 * 500KB rather than 2.5MB.
 */
export async function preparePhoto(photo: PickedPhoto): Promise<PickedPhoto> {
  const longest = Math.max(photo.width, photo.height);
  if (!longest || longest <= MAX_EDGE) {
    // Already small. Re-encoding would cost quality for nothing.
    return photo;
  }

  const resize = photo.width >= photo.height ? { width: MAX_EDGE } : { height: MAX_EDGE };
  const out = await ImageManipulator.manipulateAsync(photo.uri, [{ resize }], {
    compress: QUALITY,
    format: ImageManipulator.SaveFormat.JPEG,
  });

  return { uri: out.uri, width: out.width, height: out.height };
}

export interface UploadOutcome {
  /** Photos that made it all the way to a row plus an object. */
  added: number;
  /** Photos that did not, for any reason. */
  failed: number;
  /** Set when the database refused because an album or a person is full. */
  capReached: boolean;
}

/**
 * Add photos to a plan, one at a time, reporting progress as it goes.
 *
 * **The row goes in before the bytes do**, which is the opposite of the
 * obvious order and deliberate. Two reasons:
 *
 *   1. The caps live in a trigger on the row. Inserting first means someone
 *      who is already at 50 finds out immediately, rather than after their
 *      phone has pushed eight megabytes over a hotel wifi.
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
export async function uploadPhotos(
  planId: string,
  userId: string,
  photos: PickedPhoto[],
  onProgress?: (done: number, total: number) => void,
): Promise<UploadOutcome> {
  let added = 0;
  let failed = 0;
  let capReached = false;

  for (const [index, picked] of photos.entries()) {
    let insertedId: string | null = null;
    try {
      const prepared = await preparePhoto(picked);
      const path = `${planId}/${userId}/${photoKey()}.jpg`;

      const { data: row, error: insertError } = await supabase
        .from('plan_photos')
        .insert({
          plan_id: planId,
          uploaded_by: userId,
          storage_path: path,
          width: prepared.width,
          height: prepared.height,
        })
        .select('id')
        .single();

      if (insertError) {
        // The trigger raises these two by name. Everything else is a genuine
        // failure worth counting separately, because a full album is not an
        // error the person can do anything about by retrying.
        if (/photo_cap_reached/.test(insertError.message)) {
          capReached = true;
          break;
        }
        throw insertError;
      }
      insertedId = row.id;

      const base64 = await FileSystem.readAsStringAsync(prepared.uri, { encoding: 'base64' });
      const { error: uploadError } = await supabase.storage
        .from(PHOTO_BUCKET)
        .upload(path, decode(base64), { contentType: 'image/jpeg', upsert: false });

      if (uploadError) throw uploadError;

      added += 1;
      insertedId = null;
    } catch (error) {
      console.error('Photo upload failed', error);
      failed += 1;

      // Roll the row back so the grid never shows a tile with nothing behind
      // it. Best-effort: if this fails too, the uploader still has a delete.
      if (insertedId) {
        await supabase.from('plan_photos').delete().eq('id', insertedId);
      }
    } finally {
      onProgress?.(index + 1, photos.length);
    }
  }

  return { added, failed, capReached };
}

export interface SignedPhoto extends PlanPhoto {
  url: string;
}

interface SignedBatch {
  photos: SignedPhoto[];
  /** When these URLs should be treated as stale. */
  expiresAt: number;
}

/**
 * Turn rows into displayable photos.
 *
 * A private bucket has no equivalent of `getPublicUrl`, so every render needs
 * signatures. `createSignedUrls` takes the whole batch in one request, which
 * is the difference between one round trip per album and one per tile.
 *
 * Rows whose object has gone missing are dropped rather than rendered as a
 * broken tile: the signer reports per-path errors, and a photo we cannot show
 * is better absent than grey.
 */
export async function signPhotos(photos: PlanPhoto[]): Promise<SignedBatch> {
  if (!photos.length) return { photos: [], expiresAt: Date.now() + SIGNED_URL_TTL_SECONDS * 1000 };

  const { data, error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrls(
      photos.map((p) => p.storage_path),
      SIGNED_URL_TTL_SECONDS,
    );
  if (error) throw error;

  const urlByPath = new Map<string, string>();
  for (const entry of data ?? []) {
    if (entry.signedUrl && !entry.error && entry.path) {
      urlByPath.set(entry.path, entry.signedUrl);
    }
  }

  return {
    photos: photos.flatMap((p) => {
      const url = urlByPath.get(p.storage_path);
      return url ? [{ ...p, url }] : [];
    }),
    expiresAt: Date.now() + SIGNED_URL_TTL_SECONDS * 1000 - RESIGN_MARGIN_MS,
  };
}

/** Whether a batch signed at some point in the past is due for re-signing. */
export function isBatchStale(expiresAt: number, now: number = Date.now()): boolean {
  return now >= expiresAt;
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
    .remove([photo.storage_path]);
  if (objectError) throw objectError;

  const { error: rowError } = await supabase.from('plan_photos').delete().eq('id', photo.id);
  if (rowError) throw rowError;
}

/**
 * Every object this person has put in an album, by exact path.
 *
 * `purgeOwnedFiles` in lib/storage.ts works by listing `<userId>/` in buckets
 * that are keyed by owner. This bucket is keyed by *plan*, because that is
 * what the storage policies need to read to decide who may look, so there is
 * no folder to list. The rows are the index instead, which is the other half
 * of why uploads write them first.
 */
export async function listOwnedPhotoPaths(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('plan_photos')
    .select('storage_path')
    .eq('uploaded_by', userId);
  if (error) throw error;
  return (data ?? []).map((row) => row.storage_path);
}
