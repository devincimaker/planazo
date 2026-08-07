import type { Metadata } from 'next';

import AppLinkPage from '@/components/AppLinkPage';
import { JOIN, LANG } from '@/lib/copy';
import styles from '../../applink.module.css';

const copy = JOIN[LANG];

export const metadata: Metadata = {
  title: `${copy.metaTitle} · Planazo`,
  description: copy.metaDescription,
  // An invite is addressed to one person and the code is the whole secret.
  // Nothing about this page belongs in a search index.
  robots: { index: false, follow: false },
};

/** Same alphabet the app generates and accepts, minus the lookalike letters. */
function readableCode(raw: string): string | null {
  return decodeURIComponent(raw).toUpperCase().match(/^[A-HJ-NP-Z2-9]{8}$/)?.[0] ?? null;
}

/**
 * Where an invite link lands for someone without the app (PLA-77).
 *
 * Anyone who has Planazo never sees this: iOS matches the URL against the
 * associated domain and opens the app instead, which is the entire reason the
 * shared link is https rather than `planazo://`.
 *
 * The group is deliberately not named here. Doing so would mean giving the
 * marketing site a database, and an invite code is passed around in group
 * chats where it will outlive the invitation. The page is about the app, and
 * the app is where anything about the group belongs.
 *
 * The code block below is the one thing the plan page has no use for: an invite
 * can also be typed in by hand, while a plan link admits nobody.
 */
export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const shown = readableCode(code);

  return (
    <AppLinkPage copy={copy}>
      {shown ? (
        <div className={styles.codeBlock}>
          <p className={styles.codeLabel}>{copy.codeLabel}</p>
          <p className={styles.code}>{shown}</p>
        </div>
      ) : null}
    </AppLinkPage>
  );
}
