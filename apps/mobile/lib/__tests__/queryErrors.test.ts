import { errorCopy, isNotFoundError, isTimeoutError, retryQuery } from '../queryErrors';
import { RequestTimeoutError } from '../timeoutFetch';

/** What `.single()` throws when RLS filters the row away, or it never existed. */
const notFound = { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' };
const forbidden = { code: '42501', message: 'new row violates row-level security policy' };
const unreachable = new Error('Failed to reach Supabase at https://x.supabase.co/rest/v1/plans.');

describe('isNotFoundError', () => {
  it('recognises a zero-row .single()', () => {
    expect(isNotFoundError(notFound)).toBe(true);
  });

  it('does not claim every failure is a missing row', () => {
    expect(isNotFoundError(forbidden)).toBe(false);
    expect(isNotFoundError(unreachable)).toBe(false);
    expect(isNotFoundError(undefined)).toBe(false);
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

  it('falls back to something honest rather than blank', () => {
    const copy = errorCopy(new Error('boom'));
    expect(copy.title).toBeTruthy();
    expect(copy.body).toBeTruthy();
  });
});
