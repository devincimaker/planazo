import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { createTimeoutFetch } from './timeoutFetch';

function getRequiredEnv(name: 'EXPO_PUBLIC_SUPABASE_URL' | 'EXPO_PUBLIC_SUPABASE_ANON_KEY') {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

const supabaseUrl = getRequiredEnv('EXPO_PUBLIC_SUPABASE_URL').replace(/\/+$/, '');
const supabaseAnonKey = getRequiredEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY');

const supabaseFetch = createTimeoutFetch();

/**
 * Every key supabase-js has persisted under, remembered as it asks for them.
 *
 * `signOut({ scope: 'local' })` is not local: it still calls /logout, and when
 * that call fails it returns early *without* clearing storage. A sign-out that
 * looked done then comes back on the next launch. Tracking the keys lets us
 * clear them ourselves without guessing at the SDK's `sb-<ref>-auth-token`
 * naming, which is derived from the URL and not part of its public API.
 */
const storedKeys = new Set<string>();

/**
 * Every method returns its promise: auth-js awaits all three, so a write it was
 * not made to wait for is a session it believes it saved and hasn't.
 */
const ExpoSecureStoreAdapter = {
  getItem: (key: string) => {
    // Reads matter as much as writes: on a cold launch the SDK only ever reads
    // before we might need to sign out.
    storedKeys.add(key);
    return SecureStore.getItemAsync(key);
  },
  setItem: (key: string, value: string) => {
    storedKeys.add(key);
    return SecureStore.setItemAsync(key, value);
  },
  removeItem: async (key: string) => {
    await SecureStore.deleteItemAsync(key);
    // Forgotten only once it is really gone. Dropping it first would retire the
    // one record that lets forgetStoredSession try again.
    storedKeys.delete(key);
  },
};

/**
 * Drop every credential supabase-js has stored on this device.
 *
 * Returns false if any of them survived, and keeps those keys for the next
 * attempt. A caller must not show the login screen on the back of a false:
 * the session is still on disk, and the next launch would sign the user
 * straight back in.
 */
export async function forgetStoredSession(): Promise<boolean> {
  const cleared = await Promise.all(
    [...storedKeys].map(async (key) => {
      try {
        await SecureStore.deleteItemAsync(key);
        storedKeys.delete(key);
        return true;
      } catch (error) {
        // Deliberately left in storedKeys so the next attempt retries it.
        console.warn(`Could not delete the stored auth key ${key}.`, error);
        return false;
      }
    })
  );

  return cleared.every(Boolean);
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: {
    fetch: supabaseFetch,
  },
  auth: {
    storage: ExpoSecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
