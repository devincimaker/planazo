/**
 * One place to decide what a failed query means and what to say about it.
 *
 * Every screen that renders `isLoading ? spinner : content` needs an error
 * branch too — without one, a query that settles with no data leaves the
 * spinner up forever (PLA-15, PLA-19).
 */

/**
 * PostgREST's code for a singular query (`.single()`) that didn't match exactly
 * one row. It covers BOTH zero rows and several, so the code alone doesn't mean
 * "missing" — the row count lives in `details`.
 */
const SINGULAR_ROW_CODE = 'PGRST116';
/** Postgres insufficient_privilege: RLS rejected the statement outright. */
const FORBIDDEN_CODES = ['42501'];
/**
 * The two PostgREST group-3 codes where the *client's* token is the problem.
 *
 * PGRST300 is deliberately absent: it means the server is missing its JWT
 * secret, which is our misconfiguration, not the user's session. Telling
 * someone to sign in again would be both wrong and useless, so it falls
 * through to the generic copy.
 */
const EXPIRED_TOKEN_CODE = 'PGRST301';
const SIGN_IN_REQUIRED_CODE = 'PGRST302';

const codeOf = (error: unknown): string | undefined => {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
};

const detailsOf = (error: unknown): string | undefined => {
  if (error && typeof error === 'object' && 'details' in error) {
    const details = (error as { details?: unknown }).details;
    if (typeof details === 'string') return details;
  }
  return undefined;
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : '';

/**
 * True when the row isn't there *for this user* — deleted, or hidden by RLS.
 * These read identically from the client: a SELECT filtered to zero rows.
 *
 * More than one row shares the same code but is a real fault, not a missing
 * row, so it falls through to the generic (retryable) error instead.
 */
export function isNotFoundError(error: unknown): boolean {
  if (codeOf(error) !== SINGULAR_ROW_CODE) return false;
  const details = detailsOf(error);
  // Every caller filters on a primary key, so a code with no details is the
  // zero-row case in practice. Only claim otherwise when PostgREST says so.
  if (details === undefined) return true;
  return /\b0 rows\b/.test(details);
}

export function isForbiddenError(error: unknown): boolean {
  const code = codeOf(error);
  return !!code && FORBIDDEN_CODES.includes(code);
}

/**
 * The token, not the permission, is the problem. supabase-js refreshes in the
 * background, so this is worth retrying — and it must never be reported as
 * "you're not in this group".
 */
export function isAuthError(error: unknown): boolean {
  const code = codeOf(error);
  return code === EXPIRED_TOKEN_CODE || code === SIGN_IN_REQUIRED_CODE;
}

export function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === 'RequestTimeoutError';
}

/**
 * A not-found never becomes found by asking again, and a permission denial
 * never becomes permitted, so retrying only delays the message the user needs.
 * Everything else — including an expired token, which a refresh can fix — gets
 * two more goes.
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
  if (codeOf(error) === SIGN_IN_REQUIRED_CODE) {
    return {
      title: 'Sign in to see this',
      body: 'Your session ended. Sign in again to pick up where you left off.',
    };
  }
  if (codeOf(error) === EXPIRED_TOKEN_CODE) {
    return {
      title: 'Your sign-in expired',
      body: "Try again — we'll refresh it. If it keeps happening, sign out and back in.",
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
