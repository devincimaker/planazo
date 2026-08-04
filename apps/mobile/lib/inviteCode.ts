/** Invite codes travel as links; accept a raw code or anything containing one. */
export function inviteCodeFrom(text: string): string | null {
  return text.toUpperCase().match(/[A-HJ-NP-Z2-9]{8}/)?.[0] ?? null;
}
