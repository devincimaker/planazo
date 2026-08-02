/**
 * One place to decide what a failed query means and what to say about it.
 *
 * Every screen that renders `isLoading ? spinner : content` needs an error
 * branch too — without one, a query that settles with no data leaves the
 * spinner up forever (PLA-15, PLA-19).
 *
 * It also decides when a failure is bad enough to throw the user's session
 * away, which is why the auth-side shapes are read here too (PLA-36).
 */
import { TIMED_OUT_PREFIX, UNREACHABLE_PREFIX } from './timeoutFetch';

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
/**
 * Raised by the enforce_plan_cap trigger when a yes would exceed max_people
 * (PLA-20). PostgREST's PTxyz convention turns the SQLSTATE into the HTTP
 * status, so this arrives as a 409 rather than an opaque 500.
 */
const PLAN_FULL_CODE = 'PT409';

/**
 * GoTrue's two verdicts that matter to us. It marks a failure it wants retried
 * — anything fetch threw, plus 502/503/504 — and pointedly does *not* delete
 * the stored session for those. `AuthApiError` is the opposite: the server read
 * the token and refused it, and supabase-js has already dropped the session.
 */
/**
 * The single name GoTrue treats as "try again" — anything fetch threw, plus
 * 502/503/504. It is the one error class for which the SDK leaves the stored
 * session alone; for every other error of its own it calls _removeSession().
 * That asymmetry is the whole of the classification below.
 */
const RETRYABLE_FETCH_ERROR = 'AuthRetryableFetchError';

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

const nameOf = (error: unknown): string | undefined => {
  if (error && typeof error === 'object' && 'name' in error) {
    const name = (error as { name?: unknown }).name;
    if (typeof name === 'string') return name;
  }
  return undefined;
};

const messageOf = (error: unknown): string => {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return typeof error === 'string' ? error : '';
};

/**
 * Neither client hands our own errors back intact. postgrest-js flattens a
 * thrown fetch error into a plain object and folds the class name into the
 * message ("Error: Failed to reach Supabase…"); GoTrue re-throws it as its own
 * class, keeping the message bare. Strip the name so one prefix matches both.
 */
const NAME_PREFIX = /^[A-Za-z]*Error: /;
const bareMessage = (error: unknown): string => messageOf(error).replace(NAME_PREFIX, '');

/**
 * GoTrue tags its own errors with a hidden flag rather than a code. Duck-typed
 * like the PostgREST readers above so this module stays free of the SDK — and
 * so a test can describe one without constructing it.
 */
const isGoTrueError = (error: unknown): boolean =>
  !!error && typeof error === 'object' && '__isAuthError' in error;

const isRetryableFetchError = (error: unknown): boolean =>
  isGoTrueError(error) && nameOf(error) === RETRYABLE_FETCH_ERROR;

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
  // Only a raw rejection still carries the class. Everywhere else the message
  // we wrote in timeoutFetch is all that survives the client's re-wrapping.
  return nameOf(error) === 'RequestTimeoutError' || bareMessage(error).startsWith(TIMED_OUT_PREFIX);
}

/**
 * The request never reached the server: it timed out, the host was unreachable,
 * or GoTrue itself said try again. Nothing that comes back this way says
 * anything about whether the stored session is good, so it must never be the
 * reason one gets thrown away (PLA-36).
 */
export function isOfflineError(error: unknown): boolean {
  return (
    isTimeoutError(error) ||
    isRetryableFetchError(error) ||
    bareMessage(error).startsWith(UNREACHABLE_PREFIX)
  );
}

/**
 * The stored session is gone or worthless — the one case where finishing the
 * job and signing out beats offering a retry.
 *
 * This mirrors GoTrue's own rule rather than naming error classes, because
 * GoTrue has already acted by the time we see the error: it deletes the stored
 * session for every error of its own except the retryable-fetch one. Listing
 * names instead means the two disagree, and the app offers to retry into a
 * session the SDK has already thrown away — `session_not_found` arrives as
 * AuthSessionMissingError and a mangled response as AuthUnknownError, neither
 * of which is an AuthApiError.
 *
 * PGRST301/302 is the same verdict reached from PostgREST's side.
 */
export function isInvalidSessionError(error: unknown): boolean {
  if (isOfflineError(error)) return false;
  return isAuthError(error) || isGoTrueError(error);
}

/**
 * The plan filled up. Screens grey out "I'm in" when they can see the plan is
 * full, but the last place can go between the render and the tap — so this is
 * the case that actually reaches the user, and it deserves real copy.
 */
export function isPlanFullError(error: unknown): boolean {
  return codeOf(error) === PLAN_FULL_CODE;
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
  // Covers a dead host and a 5xx alike — "or we are" is true of both, and the
  // user can act on neither beyond waiting.
  if (isOfflineError(error)) {
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

/**
 * Copy for a failed *write* — answering, withdrawing, sending dates. Shares
 * the diagnosis above but never says "didn't load", which would misdescribe
 * an action the user just took.
 */
export function actionErrorCopy(error: unknown): { title: string; body: string } {
  if (isPlanFullError(error)) {
    return {
      title: "This one's full",
      body: 'Every place is taken. One opens up if somebody drops out.',
    };
  }
  const copy = errorCopy(error);
  if (copy.title === "That didn't load") {
    return {
      title: "That didn't go through",
      body: 'Something went wrong saving your answer. Try again.',
    };
  }
  return copy;
}
