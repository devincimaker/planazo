/**
 * The file iOS fetches to decide that planazo.me links belong to the app
 * (PLA-77).
 *
 * A route handler rather than a file in `public/`, because Apple requires
 * `application/json` and a file with no extension would be served as bytes.
 *
 * Two things here are load-bearing and easy to break:
 *
 * - **`appIDs` is `<teamID>.<bundleID>`**, and must match `ios.appleTeamId`
 *   and `ios.bundleIdentifier` in `apps/mobile/app.json`. A mismatch fails
 *   silently: links simply open in Safari, with nothing logged anywhere.
 * - **Only the link paths are claimed**, `/join/*` and `/plan/*`. Claiming `/`
 *   would hand the landing page, the legal pages and every future route to the
 *   app, so the marketing site would stop being reachable from a phone that has
 *   Planazo installed. Every path listed here needs a page under `app/` too:
 *   the claim only covers phones with the app, and everyone else gets the URL
 *   as an ordinary web address.
 *
 * iOS caches this hard at install time. Editing it does not reach a phone that
 * already installed the app; reinstalling is what picks it up.
 */
const AASA = {
  applinks: {
    details: [
      {
        appIDs: ['D4ADFZ3XZL.com.planazo.app'],
        components: [
          {
            '/': '/join/*',
            comment: 'Group invite links open straight in the app.',
          },
          {
            '/': '/plan/*',
            comment: 'Shared plan links open straight in the app.',
          },
        ],
      },
    ],
  },
};

// Nothing here reads the request, so it is prerendered once at build time.
export const dynamic = 'force-static';

export function GET() {
  return new Response(JSON.stringify(AASA), {
    headers: {
      // Apple's CDN rejects anything else.
      'content-type': 'application/json',
    },
  });
}
