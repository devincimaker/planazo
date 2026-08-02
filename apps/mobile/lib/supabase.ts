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

const ExpoSecureStoreAdapter = {
  getItem: (key: string) => {
    // Reads matter as much as writes: on a cold launch the SDK only ever reads
    // before we might need to sign out.
    storedKeys.add(key);
    return SecureStore.getItemAsync(key);
  },
  setItem: (key: string, value: string) => {
    storedKeys.add(key);
    SecureStore.setItemAsync(key, value);
  },
  removeItem: (key: string) => {
    storedKeys.delete(key);
    SecureStore.deleteItemAsync(key);
  },
};

/**
 * Drop every credential supabase-js has stored on this device. Safe to call
 * after its own signOut whether that succeeded or not — deleting a key that
 * isn't there is a no-op, and a delete that fails must not stop the others.
 */
export async function forgetStoredSession(): Promise<void> {
  const keys = [...storedKeys];
  storedKeys.clear();

  await Promise.all(
    keys.map((key) =>
      SecureStore.deleteItemAsync(key).catch((error) => {
        console.warn(`Could not delete the stored auth key ${key}.`, error);
      })
    )
  );
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
