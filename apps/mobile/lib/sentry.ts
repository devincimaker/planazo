import * as Sentry from '@sentry/react-native';

// These must stay as static `process.env.EXPO_PUBLIC_*` member expressions:
// babel-preset-expo inlines those at build time and leaves computed access
// alone, which resolves in dev and comes back undefined in release bundles
// (PR #23, 284ebb7). An empty or missing DSN turns reporting off entirely.
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
const SENTRY_ENV = process.env.EXPO_PUBLIC_SENTRY_ENV;

/** Strips the query string: Supabase REST filters carry row values in it. */
function stripQuery(url: unknown): unknown {
  return typeof url === 'string' ? url.split('?')[0] : url;
}

/**
 * Call once, at module scope of the root layout, before anything can throw.
 *
 * Dev clients never report: dev noise would drown the production feed, and
 * `captureError` still prints to the console there. Release and dist come from
 * the native bundle (versionName@build), so EAS's autoIncrement is what ties
 * an event to a build — nothing to set here.
 */
export function initSentry() {
  Sentry.init({
    dsn: SENTRY_DSN,
    enabled: Boolean(SENTRY_DSN) && !__DEV__,
    environment: SENTRY_ENV || 'development',
    // The app carries plan titles, messages and emails; none of that belongs
    // in an event. Users are identified by Supabase id only (setSentryUser).
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.user) {
        event.user = event.user.id ? { id: event.user.id } : undefined;
      }
      return event;
    },
    beforeBreadcrumb(breadcrumb) {
      // Console lines carry whatever the app was looking at when it logged.
      if (breadcrumb.category === 'console') {
        return null;
      }
      if (breadcrumb.data && 'url' in breadcrumb.data) {
        breadcrumb.data.url = stripQuery(breadcrumb.data.url);
      }
      return breadcrumb;
    },
  });
}

/**
 * The one replacement for ad-hoc `console.error`: still prints in dev, and in
 * a release build lands the exception in Sentry with `detail` explaining what
 * the app was doing. Keep `detail` free of user content.
 */
export function captureError(error: unknown, detail: string) {
  if (__DEV__) {
    console.error(detail, error);
  }
  Sentry.captureException(error, { extra: { detail } });
}

/** Supabase user id only — never email or display name. Null on sign-out. */
export function setSentryUser(userId: string | null | undefined) {
  Sentry.setUser(userId ? { id: userId } : null);
}
