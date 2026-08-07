/** Invite codes travel as links; accept a raw code or anything containing one. */
export function inviteCodeFrom(text: string): string | null {
  return text.toUpperCase().match(/[A-HJ-NP-Z2-9]{8}/)?.[0] ?? null;
}

/**
 * The one place an invite link is spelled out (PLA-77).
 *
 * It is an https link, not `planazo://`, for two reasons: WhatsApp and the rest
 * only turn https into something tappable, and only an https link can hand the
 * people without the app somewhere useful. iOS routes it straight into the app
 * for everyone who does have it, via the associated domain declared in
 * `app.json` — so this host and `applinks:` there must always name the same
 * site, and `apps/web` must serve the matching AASA file.
 */
export function inviteLinkFor(inviteCode: string): string {
  return `https://planazo.me/join/${inviteCode}`;
}
