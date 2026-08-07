/**
 * The one place a shared link is spelled out (PLA-77, PLA-81).
 *
 * They are https links, not `planazo://`, for two reasons: WhatsApp and the rest
 * only turn https into something tappable, and only an https link can hand the
 * people without the app somewhere useful. iOS routes them straight into the app
 * for everyone who does have it, via the associated domain declared in
 * `app.json` — so this host and `applinks:` there must always name the same
 * site, and `apps/web` must serve an AASA file claiming every path built here.
 */

const SITE = 'https://planazo.me';

export function inviteLinkFor(inviteCode: string): string {
  return `${SITE}/join/${inviteCode}`;
}

/**
 * Unlike an invite link, this one admits nobody: the plan is visible to its
 * group and to no one else, and RLS is what enforces that. It is a way to point
 * at a plan for people who can already see it, which is why the web page it
 * lands on says nothing about the plan and the app answers a stranger with
 * "This plan isn't here" (PLA-19).
 */
export function planLinkFor(planId: string): string {
  return `${SITE}/plan/${planId}`;
}
