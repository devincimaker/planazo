/**
 * Outbound destinations for every CTA on the site.
 *
 * `APP_STORE_URL` is the TestFlight public link for as long as Planazo is in
 * beta: there is no store listing yet, and a product page that 404s is worse
 * than an install that works. It matters most on /join, where it is the only
 * way an invited person can get the app at all, and TestFlight builds do honour
 * associated domains, so the invite still opens straight into Planazo on the
 * second tap.
 *
 * Swap it for the real listing at release. Either constant can also be
 * overridden by its env var at build time, without a deploy of this file.
 *
 * The copy under every CTA says "beta para iOS" because of what is above.
 * `heroCtaSub`, `JOIN.ctaSub` and `META.description` in `copy.ts` move together
 * with this constant.
 */
export const APP_STORE_URL =
  process.env.NEXT_PUBLIC_APP_STORE_URL ?? 'https://testflight.apple.com/join/QvZPr4zW';

/** Nothing links here yet: there is no Android build to send anyone to. */
export const PLAY_STORE_URL =
  process.env.NEXT_PUBLIC_PLAY_STORE_URL ??
  'https://play.google.com/store/apps/details?id=com.planazo.app';

/** Where "Get Planazo" points. A /get chooser page can slot in here later. */
export const GET_APP_URL = APP_STORE_URL;

export const CONTACT_EMAIL = 'hola@planazo.me';

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://planazo.me';
