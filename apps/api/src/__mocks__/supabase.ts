// Mock Supabase client for testing

type MockQueryResult = {
  data: any;
  error: any;
  count?: number;
};

type MockQueryBuilder = {
  select: jest.Mock;
  insert: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
  eq: jest.Mock;
  neq: jest.Mock;
  or: jest.Mock;
  is: jest.Mock;
  in: jest.Mock;
  single: jest.Mock;
  maybeSingle: jest.Mock;
  order: jest.Mock;
  limit: jest.Mock;
  then: jest.Mock;
};

const createMockQueryBuilder = (): MockQueryBuilder => {
  const builder: MockQueryBuilder = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    or: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    then: jest.fn((resolve: (value: MockQueryResult) => void) => resolve({ data: [], error: null })),
  };
  return builder;
};

export const mockSupabaseAdmin = {
  from: jest.fn((_table: string) => createMockQueryBuilder()),
  auth: {
    getUser: jest.fn().mockResolvedValue({ data: { user: null }, error: null }),
  },
};

export const mockSupabase = {
  from: jest.fn((_table: string) => createMockQueryBuilder()),
  auth: {
    getSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
    getUser: jest.fn().mockResolvedValue({ data: { user: null }, error: null }),
  },
};

// Reset all mocks
export const resetMocks = () => {
  mockSupabaseAdmin.from.mockClear();
  mockSupabase.from.mockClear();
  mockSupabase.auth.getSession.mockClear();
  mockSupabase.auth.getUser.mockClear();
  mockSupabaseAdmin.auth.getUser.mockClear();
};

// Helper to set up mock responses
export const setupMockResponse = (
  client: typeof mockSupabaseAdmin | typeof mockSupabase,
  table: string,
  response: MockQueryResult
) => {
  const builder = createMockQueryBuilder();

  // Make the builder thenable with the response
  builder.then = jest.fn((resolve: (value: MockQueryResult) => void) => resolve(response));
  builder.single.mockResolvedValue(response);
  builder.maybeSingle.mockResolvedValue(response);

  client.from.mockImplementation((tableName: string) => {
    if (tableName === table) {
      return builder;
    }
    return createMockQueryBuilder();
  });

  return builder;
};
