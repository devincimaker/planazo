// Test setup file
import { mockSupabaseAdmin, mockSupabase, resetMocks } from '../__mocks__/supabase';

// Mock the supabase config module
jest.mock('../config/supabase.js', () => ({
  supabaseAdmin: mockSupabaseAdmin,
  supabase: mockSupabase,
}));

// Reset mocks before each test
beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

// Global test timeout
jest.setTimeout(10000);
