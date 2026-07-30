import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { supabase } from './supabase';

// onAuthStateChange also fires on token refresh — one write per app run is enough.
let registeredFor: string | null = null;

/** Foreground pushes show as a banner; the in-app feed is the noisy surface. */
export function initNotificationPresentation(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

/**
 * Ask for permission (first run only) and store this device's Expo push
 * token on the profile. Simulators can't receive remote pushes, so this is
 * a silent no-op there.
 */
export async function registerPushToken(userId: string): Promise<void> {
  if (!Device.isDevice) return;
  if (registeredFor === userId) return;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (!projectId) return;

  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    ({ status } = await Notifications.requestPermissionsAsync());
  }
  if (status !== 'granted') return;

  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  const { error } = await supabase
    .from('profiles')
    .update({ push_token: token })
    .eq('id', userId);
  if (!error) {
    registeredFor = userId;
  }
}

/** Sign-out stops pushes to this account's device. */
export async function clearPushToken(userId: string): Promise<void> {
  registeredFor = null;
  if (!Device.isDevice) return;
  await supabase.from('profiles').update({ push_token: null }).eq('id', userId);
}
