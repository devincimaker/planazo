import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { supabase } from './supabase';

export async function pickFromLibrary(opts: { square?: boolean } = {}): Promise<string | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    Alert.alert('Photos access needed', 'Allow photo access in Settings to pick an image.');
    return null;
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: !!opts.square,
    ...(opts.square ? { aspect: [1, 1] as [number, number] } : {}),
    quality: 0.7,
  });
  return result.canceled ? null : (result.assets[0]?.uri ?? null);
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

/** PLA-30. One folder per group, which is what the storage policies key on. */
export const GROUP_PHOTO_BUCKET = 'group-images';

export function groupPhotoPath(groupId: string): string {
  return `${groupId}/cover.jpg`;
}

/** Uploads the group's photo and returns the URL to store on the row. */
export async function uploadGroupPhoto(groupId: string, uri: string): Promise<string> {
  const path = groupPhotoPath(groupId);
  await uploadJpeg(GROUP_PHOTO_BUCKET, path, uri, true);
  const { data } = supabase.storage.from(GROUP_PHOTO_BUCKET).getPublicUrl(path);
  // Every photo for a group has the same object name, so the URL has to change
  // or the replaced image stays on screen until the CDN lets go of it.
  return `${data.publicUrl}?t=${Date.now()}`;
}

export async function removeGroupPhoto(groupId: string): Promise<void> {
  const { error } = await supabase.storage
    .from(GROUP_PHOTO_BUCKET)
    .remove([groupPhotoPath(groupId)]);
  if (error) throw error;
}
