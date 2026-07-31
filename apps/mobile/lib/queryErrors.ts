/**
 * One place to decide what a failed query means and what to say about it.
 *
 * Every screen that renders `isLoading ? spinner : content` needs an error
 * branch too — without one, a query that settles with no data leaves the
 * spinner up forever (PLA-15, PLA-19).
 */

/** PostgREST's code for `.single()` matching zero rows. */
const NOT_FOUND_CODE = 'PGRST116';
/** RLS rejected the write/read outright, rather than filtering it to nothing. */
const FORBIDDEN_CODES = ['42501', 'PGRST301'];

const codeOf = (error: unknown): string | undefined => {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : '';

/**
 * True when the row isn't there *for this user* — deleted, or hidden by RLS.
 * These read identically from the client: a SELECT filtered to zero rows.
 */
export function isNotFoundError(error: unknown): boolean {
  return codeOf(error) === NOT_FOUND_CODE;
}

export function isForbiddenError(error: unknown): boolean {
  const code = codeOf(error);
  return !!code && FORBIDDEN_CODES.includes(code);
}

export function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === 'RequestTimeoutError';
}

/**
 * A not-found never becomes found by asking again, so retrying only delays the
 * message the user needs. Everything else gets two more goes.
 */
export function retryQuery(failureCount: number, error: unknown): boolean {
  if (isNotFoundError(error) || isForbiddenError(error)) return false;
  return failureCount < 2;
}

/** Screen-agnostic copy for a failed fetch. Screens override the not-found case. */
export function errorCopy(error: unknown): { title: string; body: string } {
  if (isTimeoutError(error)) {
    return {
      title: 'That took too long',
      body: 'The connection stalled before anything came back. Check your signal and try again.',
    };
  }
  if (isForbiddenError(error)) {
    return {
      title: "You can't see this",
      body: "You're not in the group this belongs to. Ask someone in it for an invite.",
    };
  }
  if (messageOf(error).startsWith('Failed to reach Supabase')) {
    return {
      title: "Couldn't reach Planazo",
      body: "You're offline, or we are. Try again in a moment.",
    };
  }
  return {
    title: "That didn't load",
    body: 'Something went wrong fetching this. Try again.',
  };
}
