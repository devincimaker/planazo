import { create } from 'zustand';
import { Session, User } from '@supabase/supabase-js';
import type { Profile } from '@planazo/shared';
import { setSentryUser } from '../lib/sentry';

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  isLoading: boolean;
  isInitialized: boolean;
  setSession: (session: Session | null) => void;
  setUser: (user: User | null) => void;
  setProfile: (profile: Profile | null) => void;
  setIsLoading: (isLoading: boolean) => void;
  setIsInitialized: (isInitialized: boolean) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  user: null,
  profile: null,
  isLoading: true,
  isInitialized: false,
  setSession: (session) => {
    // Every session change flows through here, so this is the one place the
    // Sentry identity (Supabase id only) tracks who events belong to.
    setSentryUser(session?.user.id ?? null);
    set({ session, user: session?.user ?? null });
  },
  setUser: (user) => set({ user }),
  setProfile: (profile) => set({ profile }),
  setIsLoading: (isLoading) => set({ isLoading }),
  setIsInitialized: (isInitialized) => set({ isInitialized }),
  logout: () => {
    setSentryUser(null);
    set({ session: null, user: null, profile: null });
  },
}));
