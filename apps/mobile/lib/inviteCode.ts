/**
 * Reading a code back out of whatever someone pasted.
 *
 * The other direction — building the link we hand out — lives in
 * `lib/shareLinks`, next to the plan link that shares its rules.
 */

/** Invite codes travel as links; accept a raw code or anything containing one. */
export function inviteCodeFrom(text: string): string | null {
  return text.toUpperCase().match(/[A-HJ-NP-Z2-9]{8}/)?.[0] ?? null;
}
