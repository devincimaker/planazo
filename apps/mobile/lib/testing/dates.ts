/**
 * Relative dates for test fixtures. Lives here rather than in a `__tests__/`
 * folder for the same reason actionSheet.ts does: jest-expo's testMatch
 * collects anything under `__tests__/` as a suite of its own.
 *
 * **A fixture date must never be a literal.** Every screen that lists plans
 * sorts or filters on whether they have passed — the feed and the group screen
 * drop past plans, plan detail hides the date picker once the last option is
 * gone — so a literal calendar date silently changes what a test asserts the
 * morning after it goes by. It does not fail loudly on the day it was written,
 * and it does not fail in the commit that introduced it. It fails at midnight,
 * at every commit at once, against nothing anybody changed.
 *
 * That has now cost two debugging sessions (d255cd9 and the pass after it, 20
 * tests between them). Take the offset, not the date.
 */
export function iso(daysFromNow: number, hour = 19) {
  const now = new Date();
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + daysFromNow,
    hour,
    0,
    0
  ).toISOString();
}
