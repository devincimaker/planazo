import {
  errorCopy,
  isAuthError,
  isNotFoundError,
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
