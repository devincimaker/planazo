import {
  blockUser,
  contentViolation,
  fetchBlockedIds,
  submitReport,
  unblockUser,
} from '../moderation';
import { supabase } from '../supabase';

jest.mock('../supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));

const mockFrom = supabase.from as jest.Mock;
const mockRpc = supabase.rpc as jest.Mock;

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
  mockRpc.mockImplementation(() => Promise.resolve({ error: null }));
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
  /**
   * One RPC, not an insert followed by a block: as two calls, a report that
   * landed followed by a block that failed read as total failure, and the
   * retry filed the report twice. file_report does both or neither.
   */
  it('sends report and block through the one transactional RPC', async () => {
    await submitReport({
      subjectType: 'plan',
      subjectId: 'p1',
      reason: 'harassment',
      note: '  awful  ',
      blockUserId: 'them',
    });

    expect(mockRpc).toHaveBeenCalledWith('file_report', {
      p_subject_type: 'plan',
      p_subject_id: 'p1',
      p_reason: 'harassment',
      p_note: 'awful',
      p_block_user_id: 'them',
    });
  });

  it('passes a null block and an empty note when neither is given', async () => {
    await submitReport({ subjectType: 'group', subjectId: 'g1', reason: 'other' });

    expect(mockRpc).toHaveBeenCalledWith(
      'file_report',
      expect.objectContaining({ p_note: '', p_block_user_id: null }),
    );
  });

  it('surfaces a failure rather than swallowing it', async () => {
    mockRpc.mockImplementationOnce(() => Promise.resolve({ error: { message: 'offline' } }));

    await expect(
      submitReport({ subjectType: 'plan', subjectId: 'p1', reason: 'spam' }),
    ).rejects.toMatchObject({ message: 'offline' });
  });
});

describe('contentViolation', () => {
  it('lets ordinary plans through', () => {
    expect(
      contentViolation({
        'plan title': 'Friday asado at ours',
        'plan description': 'Bring spices and grapes — the good gobbledygook.',
        location: 'Scunthorpe',
      }),
    ).toBeNull();
  });

  it('names the field that carries a blocked term', () => {
    expect(contentViolation({ 'group name': 'the faggot club' })).toContain('group name');
  });

  it('sees through lookalike characters and casing', () => {
    expect(contentViolation({ name: 'F4GG0T' })).not.toBeNull();
    expect(contentViolation({ name: 'ñíggér' })).not.toBeNull();
  });

  it('catches plurals without leaking into longer words', () => {
    expect(contentViolation({ note: 'retards' })).not.toBeNull();
    // "spices" contains "spic" + "es"; a broader suffix rule would flag it.
    expect(contentViolation({ note: 'jar of spices' })).toBeNull();
    expect(contentViolation({ note: 'rapeseed fields walk' })).toBeNull();
  });

  it('skips empty and missing fields', () => {
    expect(contentViolation({ a: '', b: null, c: undefined })).toBeNull();
  });
});
