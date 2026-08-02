import { purgeOwnedFiles } from '../storage';
import { supabase } from '../supabase';

jest.mock('../supabase', () => ({
  supabase: { storage: { from: jest.fn() } },
}));

const mockStorageFrom = supabase.storage.from as unknown as jest.Mock;

/** A bucket that behaves: everything listed disappears when removed. */
function bucket(initial: string[]) {
  let files = [...initial];
  const list = jest.fn(async (_folder: string, opts: { limit: number; offset: number }) => ({
    data: files.slice(opts.offset, opts.offset + opts.limit).map((name) => ({ name })),
    error: null,
  }));
  const remove = jest.fn(async (paths: string[]) => {
    const names = new Set(paths.map((p) => p.split('/').pop()));
    files = files.filter((f) => !names.has(f));
    return { data: paths, error: null };
  });
  return { list, remove, get files() { return files; } };
}

let consoleError: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  // The failure paths log deliberately; keep the test output readable.
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => consoleError.mockRestore());

describe('purgeOwnedFiles', () => {
  it('reports nothing left when both buckets empty cleanly', async () => {
    const avatars = bucket(['face.jpg']);
    const shots = bucket(['a.jpg', 'b.jpg']);
    mockStorageFrom.mockImplementation((name: string) =>
      name === 'avatars' ? avatars : shots,
    );

    await expect(purgeOwnedFiles('u1')).resolves.toEqual({ failed: [] });
    expect(avatars.files).toEqual([]);
    expect(shots.files).toEqual([]);
  });

  // The bug this replaced: list() stops at 100 by default, so anybody with a
  // long feedback history kept every file past the first page forever.
  it('follows pagination past the first hundred objects', async () => {
    const many = Array.from({ length: 250 }, (_, i) => `shot-${i}.jpg`);
    const shots = bucket(many);
    const avatars = bucket([]);
    mockStorageFrom.mockImplementation((name: string) =>
      name === 'avatars' ? avatars : shots,
    );

    await expect(purgeOwnedFiles('u1')).resolves.toEqual({ failed: [] });
    expect(shots.files).toEqual([]);
    expect(shots.remove).toHaveBeenCalledTimes(3);
    expect(shots.remove.mock.calls.flatMap(([paths]) => paths)).toHaveLength(250);
    expect(shots.remove.mock.calls[0][0][0]).toBe('u1/shot-0.jpg');
  });

  it('names the bucket when the listing fails', async () => {
    mockStorageFrom.mockImplementation((name: string) =>
      name === 'avatars'
        ? { list: jest.fn(async () => ({ data: null, error: { message: 'offline' } })) }
        : bucket([]),
    );

    await expect(purgeOwnedFiles('u1')).resolves.toEqual({ failed: ['avatars'] });
  });

  it('names the bucket when the removal fails', async () => {
    mockStorageFrom.mockImplementation((name: string) =>
      name === 'avatars'
        ? {
            list: jest.fn(async () => ({ data: [{ name: 'face.jpg' }], error: null })),
            remove: jest.fn(async () => ({ data: null, error: { message: 'denied' } })),
          }
        : bucket([]),
    );

    await expect(purgeOwnedFiles('u1')).resolves.toEqual({ failed: ['avatars'] });
  });

  // remove() can come back without an error having deleted nothing at all when
  // a policy blocks it, so "no error" is not evidence the files are gone.
  it('catches a removal that silently deleted nothing', async () => {
    mockStorageFrom.mockImplementation((name: string) =>
      name === 'avatars'
        ? {
            list: jest.fn(async () => ({ data: [{ name: 'face.jpg' }], error: null })),
            remove: jest.fn(async () => ({ data: [], error: null })),
          }
        : bucket([]),
    );

    await expect(purgeOwnedFiles('u1')).resolves.toEqual({ failed: ['avatars'] });
  });

  it('a failure in one bucket does not stop the other being emptied', async () => {
    const shots = bucket(['a.jpg']);
    mockStorageFrom.mockImplementation((name: string) =>
      name === 'avatars'
        ? { list: jest.fn(async () => ({ data: null, error: { message: 'offline' } })) }
        : shots,
    );

    await expect(purgeOwnedFiles('u1')).resolves.toEqual({ failed: ['avatars'] });
    expect(shots.files).toEqual([]);
  });
});
