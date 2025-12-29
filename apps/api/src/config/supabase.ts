import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://zorflbkhfashxojvqplz.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Service role client for server-side operations (bypasses RLS)
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Anon client for client-like operations (respects RLS)
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || 'sb_publishable_ASny6OVK0oD0WTgcaaGLgw_UL8P2_yh';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
