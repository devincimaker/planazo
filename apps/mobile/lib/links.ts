/**
 * Outbound destinations the app links to.
 *
 * These mirror the pages in `apps/web` — keep them in step, and never point at
 * a URL that is not deployed. App Review Guideline 5.1.1(i) wants the privacy
 * policy reachable *from inside the app*, not only from the store listing, so
 * `PRIVACY_URL` has to resolve before submission.
 */
export const SITE_URL = 'https://planazo.me';
export const PRIVACY_URL = `${SITE_URL}/privacy`;
export const TERMS_URL = `${SITE_URL}/terms`;
export const SUPPORT_URL = `${SITE_URL}/support`;

export const CONTACT_EMAIL = 'hola@planazo.me';
