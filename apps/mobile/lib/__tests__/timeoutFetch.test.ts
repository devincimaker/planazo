import {
  createTimeoutFetch,
  RequestTimeoutError,
  REQUEST_TIMEOUT_MS,
  STORAGE_TIMEOUT_MS,
} from '../timeoutFetch';

const REST_URL = 'https://x.supabase.co/rest/v1/plans';
const STORAGE_URL = 'https://x.supabase.co/storage/v1/object/avatars/me.jpg';

/** A fetch that never settles on its own — the PLA-15 hung socket. */
function hangingFetch(): jest.Mock {
  return jest.fn(
    (_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('Aborted');
          error.name = 'AbortError';
          reject(error);
        });
      })
  );
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('createTimeoutFetch', () => {
  it('passes a successful response straight through', async () => {
    const ok = new Response('{}', { status: 200 });
    const timeoutFetch = createTimeoutFetch(jest.fn().mockResolvedValue(ok));

    await expect(timeoutFetch(REST_URL)).resolves.toBe(ok);
  });

  it('rejects a request that never settles, instead of hanging forever', async () => {
    const timeoutFetch = createTimeoutFetch(hangingFetch());
    const pending = timeoutFetch(REST_URL);
    const assertion = expect(pending).rejects.toBeInstanceOf(RequestTimeoutError);

    await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await assertion;
  });

  it('gives storage longer, so a slow upload is not mistaken for a dead socket', async () => {
    const timeoutFetch = createTimeoutFetch(hangingFetch());
    const pending = timeoutFetch(STORAGE_URL);
    const assertion = expect(pending).rejects.toBeInstanceOf(RequestTimeoutError);

    // Still in flight at the point a REST call would have been abandoned.
    await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1000);
    const settled = jest.fn();
    void pending.catch(settled);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(STORAGE_TIMEOUT_MS);
    await assertion;
  });

  it('clears the deadline once the request settles', async () => {
    const timeoutFetch = createTimeoutFetch(jest.fn().mockResolvedValue(new Response('{}')));
    await timeoutFetch(REST_URL);

    expect(jest.getTimerCount()).toBe(0);
  });

  it('keeps a caller abort an abort, so cancelled queries are not failures', async () => {
    const controller = new AbortController();
    const timeoutFetch = createTimeoutFetch(hangingFetch());
    const pending = timeoutFetch(REST_URL, { signal: controller.signal });
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });

    controller.abort();
    await assertion;
  });

  it('still explains an unreachable host', async () => {
    const timeoutFetch = createTimeoutFetch(jest.fn().mockRejectedValue(new Error('Network down')));

    await expect(timeoutFetch(REST_URL)).rejects.toThrow(/Failed to reach Supabase at/);
  });
});
