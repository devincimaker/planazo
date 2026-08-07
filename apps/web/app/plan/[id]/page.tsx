import type { Metadata } from 'next';

import AppLinkPage from '@/components/AppLinkPage';
import { LANG, PLAN } from '@/lib/copy';

const copy = PLAN[LANG];

export const metadata: Metadata = {
  title: `${copy.metaTitle} · Planazo`,
  description: copy.metaDescription,
  // The id in the URL points at something private to one group. Nothing about
  // this page belongs in a search index.
  robots: { index: false, follow: false },
};

/**
 * Where a shared plan link lands for someone without the app (PLA-81).
 *
 * Anyone who has Planazo never sees this: iOS matches the URL against the
 * associated domain and opens the app instead, which is the entire reason the
 * shared link is https rather than `planazo://`.
 *
 * The id is deliberately not read, let alone rendered. Naming the plan would
 * mean giving the marketing site a database and a way to read a private group's
 * plan from a URL alone, which is exactly what RLS exists to prevent in the
 * app. The page is about the app; the plan lives there.
 */
export default function PlanLinkPage() {
  return <AppLinkPage copy={copy} />;
}
