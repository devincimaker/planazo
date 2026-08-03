import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { GROUP_PHOTO_BUCKET, groupPhotoPath } from '@planazo/shared';
import { supabase } from './supabase';

/**
 * Ask once, phrase the refusal once. Every picker in the app goes through
 * here, so there is one place that decides what "no" looks like.
 */
async function libraryPermitted(): Promise<boolean> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (perm.granted) return true;
  Alert.alert('Photos access needed', 'Allow photo access in Settings to pick an image.');
  return false;
}

export async function pickFromLibrary(opts: { square?: boolean } = {}): Promise<string | null> {
  if (!(await libraryPermitted())) return null;
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: !!opts.square,
    ...(opts.square ? { aspect: [1, 1] as [number, number] } : {}),
    quality: 0.7,
  });
  return result.canceled ? null : (result.assets[0]?.uri ?? null);
}

export interface PickedImage {
  uri: string;
  width: number;
  height: number;
}

/**
 * Several at once, with their dimensions, for the album (PLA-32).
 *
 * Full quality on the way out: the album downscales itself before upload, and
 * compressing twice only costs detail. Returns [] for both a cancel and a
 * refusal, because neither is an error and callers treat them the same.
 */
export async function pickManyFromLibrary(limit: number): Promise<PickedImage[]> {
  if (!(await libraryPermitted())) return [];
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: limit,
    quality: 1,
  });
  if (result.canceled) return [];
  return result.assets.map((a) => ({ uri: a.uri, width: a.width ?? 0, height: a.height ?? 0 }));
}

export async function takePhoto(): Promise<string | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    Alert.alert('Camera access needed', 'Allow camera access in Settings to take a photo.');
    return null;
  }
  const result = await ImagePicker.launchCameraAsync({
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.7,
  });
  return result.canceled ? null : (result.assets[0]?.uri ?? null);
}

export async function uploadJpeg(bucket: string, path: string, uri: string, upsert = false): Promise<void> {
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, decode(base64), { upsert, contentType: 'image/jpeg' });
  if (error) throw error;
}

/**
 * Uploads to a public bucket and returns the URL to store on the row.
 *
 * Every photo of a given thing reuses one object name, so the URL has to change
 * or the replaced image stays on screen until the CDN lets go of it. That is
 * why both `profiles.avatar_url` and `groups.image_url` hold a full URL with a
 * `?t=` suffix rather than a bare storage path.
 */
export async function uploadPublicPhoto(bucket: string, path: string, uri: string): Promise<string> {
  await uploadJpeg(bucket, path, uri, true);
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return `${data.publicUrl}?t=${Date.now()}`;
}

export const uploadGroupPhoto = (groupId: string, uri: string): Promise<string> =>
  uploadPublicPhoto(GROUP_PHOTO_BUCKET, groupPhotoPath(groupId), uri);

export const uploadAvatar = (userId: string, uri: string): Promise<string> =>
  uploadPublicPhoto('avatars', `${userId}/avatar.jpg`, uri);

export async function removeGroupPhoto(groupId: string): Promise<void> {
  const { error } = await supabase.storage
    .from(GROUP_PHOTO_BUCKET)
    .remove([groupPhotoPath(groupId)]);
  if (error) throw error;
}
