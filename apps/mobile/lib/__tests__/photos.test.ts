import {
  clearSignedUrlCache,
  listOwnedPhotoPaths,
  signPhotos,
  uploadPhotos,
  type PhotoRow,
} from '../photos';
import { supabase } from '../supabase';
import { uploadJpeg } from '../images';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';

jest.mock('../supabase', () => ({
  supabase: { storage: { from: jest.fn() }, from: jest.fn() },
}));

jest.mock('../images', () => ({
  pickManyFromLibrary: jest.fn(),
  uploadJpeg: jest.fn(),
}));

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}));

jest.mock('expo-file-system/legacy', () => ({
  deleteAsync: jest.fn(async () => {}),
  readAsStringAsync: jest.fn(),
}));

const mockStorageFrom = supabase.storage.from as unknown as jest.Mock;
const mockFrom = supabase.from as unknown as jest.Mock;
const mockUploadJpeg = uploadJpeg as jest.Mock;
const mockManipulate = ImageManipulator.manipulateAsync as jest.Mock;
const mockDeleteAsync = FileSystem.deleteAsync as jest.Mock;

function row(overrides: Partial<PhotoRow>): PhotoRow {
  return {
    id: 'p1',
    plan_id: 'plan-1',
    uploaded_by: 'u1',
    storage_path: 'plan-1/u1/a.jpg',
    thumb_path: 'plan-1/u1/a_thumb.jpg',
    width: 2048,
    height: 1536,
    created_at: '2026-08-03T10:00:00Z',
    uploader: { display_name: 'Lucía' },
    ...overrides,
  };
}

/** The signer answers for exactly the paths given, minus `missing`. */
function primeSigner(missing: string[] = []) {
  const createSignedUrls = jest.fn(async (paths: string[]) => ({
    data: paths
      .filter((p) => !missing.includes(p))
      .map((path) => ({ path, signedUrl: `https://signed/${path}`, error: null })),
    error: null,
  }));
  const remove = jest.fn(async (paths: string[]) => ({ data: paths, error: null }));
  mockStorageFrom.mockReturnValue({ createSignedUrls, remove });
  return { createSignedUrls, remove };
}

let consoleError: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  // The cache is module state and outlives a test the way it outlives a
  // render. Every test starts with nothing minted.
  clearSignedUrlCache();
  // The upload failure path logs deliberately; keep the test output readable.
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => consoleError.mockRestore());

describe('signPhotos', () => {
  it('signs originals and renditions in one batch and keeps them apart', async () => {
    const { createSignedUrls } = primeSigner();
    const photos = [row({}), row({ id: 'p2', storage_path: 'plan-1/u1/b.jpg', thumb_path: null })];

    const signed = await signPhotos(photos);

    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(createSignedUrls.mock.calls[0][0]).toEqual([
      'plan-1/u1/a.jpg',
      'plan-1/u1/a_thumb.jpg',
      'plan-1/u1/b.jpg',
    ]);
    expect(signed[0].url).toBe('https://signed/plan-1/u1/a.jpg');
    expect(signed[0].thumbUrl).toBe('https://signed/plan-1/u1/a_thumb.jpg');
    // No rendition means the tile draws the original, not a broken image.
    expect(signed[1].thumbUrl).toBe(signed[1].url);
  });

  it('falls back to the original when only the rendition is missing', async () => {
    primeSigner(['plan-1/u1/a_thumb.jpg']);

    const signed = await signPhotos([row({})]);

    expect(signed).toHaveLength(1);
    expect(signed[0].thumbUrl).toBe(signed[0].url);
  });

  it('drops the photo when the original is missing, rendition or not', async () => {
    primeSigner(['plan-1/u1/a.jpg']);

    await expect(signPhotos([row({})])).resolves.toEqual([]);
  });
});

// The point of the cache is what a URL's bytes do downstream: an identical
// string keeps a mounted Image's uri identical, and iOS never re-downloads a
// tile that did not change.
describe('signPhotos cache', () => {
  it('hands a later caller the identical strings without a second request', async () => {
    const { createSignedUrls } = primeSigner();

    const first = await signPhotos([row({})]);
    const second = await signPhotos([row({})]);

    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(second[0].url).toBe(first[0].url);
    expect(second[0].thumbUrl).toBe(first[0].thumbUrl);
  });

  it('signs only what it does not hold when the album grows', async () => {
    const { createSignedUrls } = primeSigner();
    const added = row({ id: 'p2', storage_path: 'plan-1/u1/b.jpg', thumb_path: 'plan-1/u1/b_thumb.jpg' });

    await signPhotos([row({})]);
    const signed = await signPhotos([added, row({})]);

    expect(createSignedUrls).toHaveBeenCalledTimes(2);
    expect(createSignedUrls.mock.calls[1][0]).toEqual(['plan-1/u1/b.jpg', 'plan-1/u1/b_thumb.jpg']);
    expect(signed).toHaveLength(2);
  });

  it('re-signs once less than half the TTL remains', async () => {
    const { createSignedUrls } = primeSigner();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(0);

    await signPhotos([row({})]);
    nowSpy.mockReturnValue(1801 * 1000); // just past half of the 3600s TTL
    await signPhotos([row({})]);

    expect(createSignedUrls).toHaveBeenCalledTimes(2);
    nowSpy.mockRestore();
  });

  it('stops serving a dead URL once it has expired', async () => {
    primeSigner();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(0);
    await signPhotos([row({})]);

    // The object is gone: re-signing quietly omits it, so expiry is the only
    // thing standing between the grid and a broken tile.
    primeSigner(['plan-1/u1/a.jpg', 'plan-1/u1/a_thumb.jpg']);
    nowSpy.mockReturnValue(3601 * 1000);

    await expect(signPhotos([row({})])).resolves.toEqual([]);
    nowSpy.mockRestore();
  });

  // The card and the album screen are mounted together, and a realtime
  // invalidation refetches both signed queries at once. Both race past the
  // empty cache and sign, but the first response to land is the one every
  // caller gets back — two surfaces, one string, one download per tile.
  it('keeps the first-written string when two calls race', async () => {
    let call = 0;
    const createSignedUrls = jest.fn(async (paths: string[]) => {
      call += 1;
      const v = call;
      return {
        data: paths.map((path) => ({ path, signedUrl: `https://signed/${path}?v=${v}`, error: null })),
        error: null,
      };
    });
    mockStorageFrom.mockReturnValue({ createSignedUrls, remove: jest.fn() });

    const [a, b] = await Promise.all([signPhotos([row({})]), signPhotos([row({})])]);

    expect(createSignedUrls).toHaveBeenCalledTimes(2);
    expect(b[0].url).toBe(a[0].url);
    expect(b[0].thumbUrl).toBe(a[0].thumbUrl);
  });
});

describe('uploadPhotos', () => {
  /** Insert chain that succeeds, remembering what was inserted. */
  function primeInsert() {
    const inserted: Record<string, unknown>[] = [];
    const deleteEq = jest.fn(async () => ({ data: null, error: null }));
    mockFrom.mockImplementation(() => ({
      insert: (values: Record<string, unknown>) => {
        inserted.push(values);
        return { select: () => ({ single: async () => ({ data: { id: 'row-1' }, error: null }) }) };
      },
      delete: () => ({ eq: deleteEq }),
    }));
    return { inserted, deleteEq };
  }

  beforeEach(() => {
    // Echo the resize back so each manipulation is distinguishable by uri.
    mockManipulate.mockImplementation(async (uri, actions) => {
      const edge = actions[0].resize.width ?? actions[0].resize.height;
      return { uri: `${uri}#${edge}`, width: edge, height: Math.round(edge * 0.75) };
    });
  });

  const bigPhoto = { uri: 'file:///pick/a.jpg', width: 4032, height: 3024 };

  it('writes the pair, rendition first, under one key', async () => {
    const { inserted } = primeInsert();
    primeSigner();
    mockUploadJpeg.mockResolvedValue(undefined);

    const outcome = await uploadPhotos({ planId: 'plan-1', userId: 'u1', photos: [bigPhoto] });

    expect(outcome).toEqual({ added: 1, failed: 0 });
    const [values] = inserted;
    expect(values.storage_path).toMatch(/^plan-1\/u1\/\w+\.jpg$/);
    expect(values.thumb_path).toBe(String(values.storage_path).replace(/\.jpg$/, '_thumb.jpg'));

    expect(mockUploadJpeg).toHaveBeenCalledTimes(2);
    expect(mockUploadJpeg.mock.calls[0][0].path).toBe(values.thumb_path);
    // The rendition is cut from the prepared 2048 image, not the original.
    expect(mockUploadJpeg.mock.calls[0][0].uri).toBe('file:///pick/a.jpg#2048#512');
    expect(mockUploadJpeg.mock.calls[1][0].path).toBe(values.storage_path);
    expect(mockUploadJpeg.mock.calls[1][0].uri).toBe('file:///pick/a.jpg#2048');

    // Both scratch renditions are collected; the picked original is not ours.
    expect(mockDeleteAsync.mock.calls.map((c) => c[0]).sort()).toEqual([
      'file:///pick/a.jpg#2048',
      'file:///pick/a.jpg#2048#512',
    ]);
  });

  it('skips the rendition when the source is already thumbnail-sized', async () => {
    const { inserted } = primeInsert();
    primeSigner();
    mockUploadJpeg.mockResolvedValue(undefined);

    await uploadPhotos({
      planId: 'plan-1',
      userId: 'u1',
      photos: [{ uri: 'file:///pick/small.jpg', width: 400, height: 300 }],
    });

    expect(inserted[0].thumb_path).toBeNull();
    expect(mockUploadJpeg).toHaveBeenCalledTimes(1);
    expect(mockManipulate).not.toHaveBeenCalled();
  });

  it('rolls back the row and the uploaded rendition when the original fails', async () => {
    const { inserted, deleteEq } = primeInsert();
    const { remove } = primeSigner();
    mockUploadJpeg
      .mockResolvedValueOnce(undefined) // the rendition makes it up
      .mockRejectedValueOnce(new Error('network died'));

    const outcome = await uploadPhotos({ planId: 'plan-1', userId: 'u1', photos: [bigPhoto] });

    expect(outcome).toEqual({ added: 0, failed: 1 });
    expect(deleteEq).toHaveBeenCalledWith('id', 'row-1');
    // An object whose row is gone is invisible to the account purge, so the
    // rendition cannot be left behind.
    expect(remove).toHaveBeenCalledWith([inserted[0].thumb_path]);
  });
});

describe('listOwnedPhotoPaths', () => {
  it('names both objects of a pair, and one for pre-thumbnail rows', async () => {
    mockFrom.mockImplementation(() => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        then: (resolve: (v: unknown) => void) =>
          Promise.resolve({
            data: [
              { storage_path: 'plan-1/u1/a.jpg', thumb_path: 'plan-1/u1/a_thumb.jpg' },
              { storage_path: 'plan-1/u1/b.jpg', thumb_path: null },
            ],
            error: null,
          }).then(resolve),
      };
      return chain;
    });

    await expect(listOwnedPhotoPaths('u1')).resolves.toEqual([
      'plan-1/u1/a.jpg',
      'plan-1/u1/a_thumb.jpg',
      'plan-1/u1/b.jpg',
    ]);
  });
});
