import {
  actionErrorCopy,
  errorCopy,
  isAuthError,
  isInvalidSessionError,
  isNotFoundError,
  isOfflineError,
  isPlanFullError,
  isTimeoutError,
  retryQuery,
} from '../queryErrors';
import { RequestTimeoutError } from '../timeoutFetch';

const SINGULAR = 'JSON object requested, multiple (or no) rows returned';

/** What `.single()` throws when RLS filters the row away, or it never existed. */
const notFound = { code: 'PGRST116', message: SINGULAR, details: 'The result contains 0 rows' };
/** Same code, opposite problem: the filter wasn't selective enough. */
const tooManyRows = { code: 'PGRST116', message: SINGULAR, details: 'The result contains 2 rows' };
const forbidden = { code: '42501', message: 'new row violates row-level security policy' };
/** PostgREST group-3: the JWT expired or failed verification. Not a denial. */
const expiredJwt = { code: 'PGRST301', message: 'JWSError JWSInvalidSignature' };
/** Group-3 too, but no token was sent and anonymous access is off. */
const signInRequired = { code: 'PGRST302', message: 'Anonymous access is disabled' };
/** Group-3 as well — but this one is OUR server missing its JWT secret. */
const serverMisconfigured = { code: 'PGRST300', message: 'JWT secret missing' };
const unreachable = new Error('Failed to reach Supabase at https://x.supabase.co/rest/v1/plans.');

/**
 * On the auth path supabase-js catches whatever our fetch wrapper threw and
 * re-throws it as its own class, keeping only the message. These are what
 * `getSession()` actually hands back, and telling them apart is the whole of
 * PLA-36.
 */
const goTrue = (name: string, message: string, status: number) =>
  Object.assign(new Error(message), { name, status, __isAuthError: true });

const wrappedUnreachable = goTrue(
  'AuthRetryableFetchError',
  'Failed to reach Supabase at https://x.supabase.co/auth/v1/token.',
  0
);
const wrappedTimeout = goTrue(
  'AuthRetryableFetchError',
  'The request took longer than 15s and was given up on.',
  0
);
/** GoTrue also marks a gateway failure retryable — our server, not the token. */
const serverDown = goTrue('AuthRetryableFetchError', 'Service Unavailable', 503);
/** The one that means the session is genuinely dead. */
const rejectedToken = goTrue(
  'AuthApiError',
  'Invalid Refresh Token: Refresh Token Not Found',
  400
);
/**
 * The other one. GoTrue peels `session_not_found` out of the response and
 * raises this instead of an AuthApiError — a session revoked, signed out
 * elsewhere, or whose user was deleted.
 */
const revokedSession = goTrue('AuthSessionMissingError', 'Auth session missing!', 400);

/**
 * And what postgrest-js does with the same two failures: flatten them into a
 * plain object, folding the class name into the message. This is the shape
 * every screen's `{ data, error }` actually receives, so it is the one that has
 * to be recognised.
 */
const flattened = (message: string) => ({ message, details: 'at fetch (…)', hint: '', code: '' });

const flatUnreachable = flattened(
  'Error: Failed to reach Supabase at http://127.0.0.1:55321/rest/v1/profiles.'
);
const flatTimeout = flattened(
  'RequestTimeoutError: The request took longer than 15s and was given up on.'
);

describe('isNotFoundError', () => {
  it('recognises a zero-row .single()', () => {
    expect(isNotFoundError(notFound)).toBe(true);
  });

  it('treats a bare code as zero rows, since every caller filters on a key', () => {
    expect(isNotFoundError({ code: 'PGRST116', message: SINGULAR })).toBe(true);
  });

  it('does not call several rows a missing row — same code, real fault', () => {
    expect(isNotFoundError(tooManyRows)).toBe(false);
  });

  it('does not claim every failure is a missing row', () => {
    expect(isNotFoundError(forbidden)).toBe(false);
    expect(isNotFoundError(expiredJwt)).toBe(false);
    expect(isNotFoundError(unreachable)).toBe(false);
    expect(isNotFoundError(undefined)).toBe(false);
  });
});

describe('isAuthError', () => {
  it('recognises the two codes where the user\'s own token is at fault', () => {
    expect(isAuthError(expiredJwt)).toBe(true);
    expect(isAuthError(signInRequired)).toBe(true);
  });

  // PGRST300 is a missing server-side JWT secret. Blaming the user's session
  // for our misconfiguration sends them to re-authenticate for nothing.
  it('does not blame the user for a server missing its JWT secret', () => {
    expect(isAuthError(serverMisconfigured)).toBe(false);
  });

  it('is not confused with an RLS denial', () => {
    expect(isAuthError(forbidden)).toBe(false);
    expect(isAuthError(notFound)).toBe(false);
  });
});

describe('isTimeoutError', () => {
  it('recognises our own deadline', () => {
    expect(isTimeoutError(new RequestTimeoutError(15000))).toBe(true);
    expect(isTimeoutError(unreachable)).toBe(false);
  });

  it('still recognises it after supabase-js has re-wrapped it', () => {
    expect(isTimeoutError(wrappedTimeout)).toBe(true);
    expect(isTimeoutError(wrappedUnreachable)).toBe(false);
  });

  // The shape every query returns. Missing it is why a dead connection used to
  // read as a generic "That didn't load" on every screen.
  it('still recognises it once postgrest-js has flattened it', () => {
    expect(isTimeoutError(flatTimeout)).toBe(true);
    expect(isTimeoutError(flatUnreachable)).toBe(false);
  });
});

describe('isOfflineError', () => {
  it('covers every way the request can fail to reach the server', () => {
    expect(isOfflineError(new RequestTimeoutError(15000))).toBe(true);
    expect(isOfflineError(unreachable)).toBe(true);
    expect(isOfflineError(wrappedTimeout)).toBe(true);
    expect(isOfflineError(wrappedUnreachable)).toBe(true);
    expect(isOfflineError(serverDown)).toBe(true);
    expect(isOfflineError(flatUnreachable)).toBe(true);
    expect(isOfflineError(flatTimeout)).toBe(true);
  });

  it('does not mistake an answered request for a missing connection', () => {
    expect(isOfflineError(rejectedToken)).toBe(false);
    expect(isOfflineError(expiredJwt)).toBe(false);
    expect(isOfflineError(notFound)).toBe(false);
    expect(isOfflineError(new Error('boom'))).toBe(false);
    expect(isOfflineError(undefined)).toBe(false);
  });
});

describe('isInvalidSessionError', () => {
  it('recognises a token the server read and refused', () => {
    expect(isInvalidSessionError(rejectedToken)).toBe(true);
    expect(isInvalidSessionError(expiredJwt)).toBe(true);
    expect(isInvalidSessionError(signInRequired)).toBe(true);
  });

  // A revoked session comes back under a different class than a bad refresh
  // token. Matching only AuthApiError left it on a retry screen that could
  // never succeed, since supabase-js had already dropped the session.
  it('recognises a session the server no longer has', () => {
    expect(isInvalidSessionError(revokedSession)).toBe(true);
    expect(isOfflineError(revokedSession)).toBe(false);
  });

  // The whole point of PLA-36: a blip must never be grounds for throwing the
  // user's session away and asking for their password again.
  it('never blames the session for a request that never landed', () => {
    expect(isInvalidSessionError(new RequestTimeoutError(15000))).toBe(false);
    expect(isInvalidSessionError(unreachable)).toBe(false);
    expect(isInvalidSessionError(wrappedTimeout)).toBe(false);
    expect(isInvalidSessionError(wrappedUnreachable)).toBe(false);
    expect(isInvalidSessionError(serverDown)).toBe(false);
    expect(isInvalidSessionError(flatUnreachable)).toBe(false);
    expect(isInvalidSessionError(flatTimeout)).toBe(false);
  });

  it('leaves the session alone for a data problem', () => {
    expect(isInvalidSessionError(notFound)).toBe(false);
    expect(isInvalidSessionError(forbidden)).toBe(false);
    expect(isInvalidSessionError(serverMisconfigured)).toBe(false);
    expect(isInvalidSessionError(new Error('boom'))).toBe(false);
  });
});

describe('retryQuery', () => {
  it('never retries a missing row — asking again cannot make it appear', () => {
    expect(retryQuery(0, notFound)).toBe(false);
  });

  it('never retries a permission failure', () => {
    expect(retryQuery(0, forbidden)).toBe(false);
  });

  // A refresh can fix an expired token, so giving up immediately would strand
  // the user on an error the very next request would have cleared.
  it('retries an expired token', () => {
    expect(retryQuery(0, expiredJwt)).toBe(true);
  });

  it('retries when a singular query matched several rows', () => {
    expect(retryQuery(0, tooManyRows)).toBe(true);
  });

  it('retries a network failure, then gives up so an error state can show', () => {
    expect(retryQuery(0, unreachable)).toBe(true);
    expect(retryQuery(1, unreachable)).toBe(true);
    expect(retryQuery(2, unreachable)).toBe(false);
  });

  it('retries a timeout — that is the whole point of the deadline', () => {
    expect(retryQuery(0, new RequestTimeoutError(15000))).toBe(true);
  });
});

describe('errorCopy', () => {
  it('names the stall for a timeout', () => {
    expect(errorCopy(new RequestTimeoutError(15000)).title).toBe('That took too long');
  });

  it('names the connection for an unreachable host', () => {
    expect(errorCopy(unreachable).title).toBe("Couldn't reach Planazo");
  });

  it('keeps the same diagnosis once supabase-js has re-wrapped the failure', () => {
    expect(errorCopy(wrappedTimeout).title).toBe('That took too long');
    expect(errorCopy(wrappedUnreachable).title).toBe("Couldn't reach Planazo");
    // "or we are" is the honest half of the copy for a gateway failure.
    expect(errorCopy(serverDown).title).toBe("Couldn't reach Planazo");
  });

  it('names the connection on the query path too, not just a raw rejection', () => {
    expect(errorCopy(flatUnreachable).title).toBe("Couldn't reach Planazo");
    expect(errorCopy(flatTimeout).title).toBe('That took too long');
  });

  it('never blames group membership for an expired token', () => {
    expect(errorCopy(expiredJwt).title).toBe('Your sign-in expired');
    expect(errorCopy(expiredJwt).body).not.toMatch(/group/i);
  });

  it('asks for a sign-in when no token was sent', () => {
    expect(errorCopy(signInRequired).title).toBe('Sign in to see this');
  });

  it('stays generic for a server-side misconfiguration', () => {
    const copy = errorCopy(serverMisconfigured);
    expect(copy.title).toBe("That didn't load");
    expect(copy.title).not.toMatch(/sign.?in/i);
    expect(copy.body).not.toMatch(/sign.?in|session/i);
  });

  it('falls back to something honest rather than blank', () => {
    const copy = errorCopy(new Error('boom'));
    expect(copy.title).toBeTruthy();
    expect(copy.body).toBeTruthy();
  });
});

describe('isPlanFullError / actionErrorCopy', () => {
  /** enforce_plan_cap's RAISE, surfaced through PostgREST's PTxyz mapping. */
  const planFull = {
    code: 'PT409',
    message: 'This plan is full',
    details: '6 of 6 places are taken',
  };

  it('recognises the cap rejection', () => {
    expect(isPlanFullError(planFull)).toBe(true);
    expect(isPlanFullError(forbidden)).toBe(false);
    expect(isPlanFullError(new Error('boom'))).toBe(false);
  });

  it('says the plan is full rather than that something broke', () => {
    const copy = actionErrorCopy(planFull);
    expect(copy.title).toBe("This one's full");
    expect(copy.body).toMatch(/drops out/i);
  });

  it('never tells someone a write "didn\'t load"', () => {
    const copy = actionErrorCopy(new Error('boom'));
    expect(copy.title).toBe("That didn't go through");
    expect(copy.body).not.toMatch(/load|fetch/i);
  });

  it('keeps the diagnosis errorCopy already makes for shared cases', () => {
    expect(actionErrorCopy(expiredJwt).title).toBe('Your sign-in expired');
    expect(actionErrorCopy(new RequestTimeoutError(15000)).title).toBe('That took too long');
  });
});
