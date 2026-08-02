import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { createTimeoutFetch } from './timeoutFetch';

// These must stay as static `process.env.EXPO_PUBLIC_*` member expressions:
// babel-preset-expo inlines those at build time, but leaves a computed access
// (process.env[name]) alone. Metro's dev server injects env at runtime, so a
// computed read still works in development and then comes back undefined in
// release bundles.
const PUBLIC_ENV = {
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
} as const;

function getRequiredEnv(name: keyof typeof PUBLIC_ENV) {
  const value = PUBLIC_ENV[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

const supabaseUrl = getRequiredEnv('EXPO_PUBLIC_SUPABASE_URL').replace(/\/+$/, '');
const supabaseAnonKey = getRequiredEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY');

const supabaseFetch = createTimeoutFetch();

const ExpoSecureStoreAdapter = {
  getItem: (key: string) => {
    return SecureStore.getItemAsync(key);
  },
  setItem: (key: string, value: string) => {
    SecureStore.setItemAsync(key, value);
  },
  removeItem: (key: string) => {
    SecureStore.deleteItemAsync(key);
  },
};

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
