/**
 * Outbound destinations for every CTA on the site.
 *
 * The stores are placeholders until the app ships. Swap these two constants
 * (or set the env vars at build time) and every button on the page follows.
 *
 * Before release, `NEXT_PUBLIC_APP_STORE_URL` wants the TestFlight public link
 * (`https://testflight.apple.com/join/<code>`) rather than a product page that
 * 404s. That matters most on /join, where it is the only way an invited person
 * can get the app at all, and TestFlight builds do honour associated domains,
 * so the invite still opens straight into Planazo on the second tap.
 */
export const APP_STORE_URL =
  process.env.NEXT_PUBLIC_APP_STORE_URL ?? 'https://apps.apple.com/app/planazo/id0000000000';

export const PLAY_STORE_URL =
  process.env.NEXT_PUBLIC_PLAY_STORE_URL ??
  'https://play.google.com/store/apps/details?id=com.planazo.app';

/** Where "Get Planazo" points. A /get chooser page can slot in here later. */
export const GET_APP_URL = APP_STORE_URL;

export const CONTACT_EMAIL = 'hola@planazo.me';

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://planazo.me';
