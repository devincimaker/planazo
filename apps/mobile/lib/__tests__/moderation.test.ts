import { blockUser, fetchBlockedIds, submitReport, unblockUser } from '../moderation';
import { supabase } from '../supabase';

jest.mock('../supabase', () => ({ supabase: { from: jest.fn() } }));

const mockFrom = supabase.from as jest.Mock;

let chain: any;
let table: string | null = null;

beforeEach(() => {
  jest.clearAllMocks();
  table = null;
  mockFrom.mockImplementation((name: string) => {
    table = name;
    chain = {
      insert: jest.fn(() => Promise.resolve({ error: null })),
      upsert: jest.fn(() => Promise.resolve({ error: null })),
      select: jest.fn(() => Promise.resolve({ data: [{ blocked_id: 'a' }], error: null })),
      delete: jest.fn(() => chain),
      eq: jest.fn(() => chain),
      then: (resolve: (v: unknown) => void) => Promise.resolve({ error: null }).then(resolve),
    };
    return chain;
  });
});

describe('blockUser', () => {
  /**
   * The trap this guards, confirmed against the branch database: PostgREST
   * turns a plain upsert into ON CONFLICT DO UPDATE, and blocked_users has no
   * UPDATE policy — there is nothing in the row worth changing. So blocking
   * somebody twice came back as an RLS failure rather than a no-op.
   */
  it('asks for ON CONFLICT DO NOTHING, which the INSERT policy can satisfy', async () => {
    await blockUser('me', 'them');

    expect(table).toBe('blocked_users');
    expect(chain.upsert).toHaveBeenCalledWith(
      { blocker_id: 'me', blocked_id: 'them' },
      expect.objectContaining({ ignoreDuplicates: true, onConflict: 'blocker_id,blocked_id' }),
    );
  });

  it('surfaces a real failure rather than swallowing it', async () => {
    mockFrom.mockImplementationOnce(() => ({
      upsert: jest.fn(() => Promise.resolve({ error: { message: 'nope' } })),
    }));

    await expect(blockUser('me', 'them')).rejects.toMatchObject({ message: 'nope' });
  });
});

describe('unblockUser', () => {
  it('deletes only this user pairing', async () => {
    await unblockUser('me', 'them');

    expect(table).toBe('blocked_users');
    expect(chain.eq).toHaveBeenCalledWith('blocker_id', 'me');
    expect(chain.eq).toHaveBeenCalledWith('blocked_id', 'them');
  });
});

describe('fetchBlockedIds', () => {
  it('returns bare ids', async () => {
    await expect(fetchBlockedIds()).resolves.toEqual(['a']);
  });
});

describe('submitReport', () => {
  it('trims the note and defaults it to empty', async () => {
    await submitReport({
      reporterId: 'me',
      subjectType: 'plan',
      subjectId: 'p1',
      reason: 'spam',
      note: '  spammy  ',
    });
    expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({ note: 'spammy' }));

    await submitReport({
      reporterId: 'me',
      subjectType: 'group',
      subjectId: 'g1',
      reason: 'other',
    });
    expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({ note: '' }));
  });
});
