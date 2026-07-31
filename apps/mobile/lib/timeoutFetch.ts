/**
 * A socket that hangs never rejects, so react-query's retry never fires and the
 * screen spins forever (PLA-15). Every request gets a deadline; storage gets a
 * longer one because a slow photo upload isn't the same as a dead connection.
 */
export const REQUEST_TIMEOUT_MS = 15_000;
export const STORAGE_TIMEOUT_MS = 60_000;

/** Thrown when our own deadline fires — distinct from a caller's abort. */
export class RequestTimeoutError extends Error {
  readonly name = 'RequestTimeoutError';
  constructor(public readonly timeoutMs: number) {
    super(`The request took longer than ${Math.round(timeoutMs / 1000)}s and was given up on.`);
  }
}

const urlOf = (input: RequestInfo | URL) =>
  typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

/**
 * Wraps fetch so a request that never settles becomes a rejection the caller
 * can act on. Caller-initiated aborts are passed through untouched, so
 * react-query cancellation and `.abortSignal()` keep working.
 */
export function createTimeoutFetch(baseFetch: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const target = urlOf(input);
    const timeoutMs = target.includes('/storage/v1/') ? STORAGE_TIMEOUT_MS : REQUEST_TIMEOUT_MS;

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    const callerSignal = init?.signal;
    const onCallerAbort = () => controller.abort();
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort();
      else callerSignal.addEventListener('abort', onCallerAbort);
    }

    try {
      return await baseFetch(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (timedOut) {
        throw new RequestTimeoutError(timeoutMs);
      }
      // A caller-initiated abort must stay an abort, or react-query treats a
      // cancelled query as a failure.
      if (callerSignal?.aborted) {
        throw error;
      }

      const message = error instanceof Error ? error.message : 'Unknown network error';
      throw new Error(
        `Failed to reach Supabase at ${target}. Check EXPO_PUBLIC_SUPABASE_URL and that the host resolves from the simulator. Original error: ${message}`
      );
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    }
  };
}
