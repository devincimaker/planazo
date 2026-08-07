import type { ReactNode } from 'react';
import Link from 'next/link';

import { GET_APP_URL } from '@/lib/links';
import styles from '@/app/applink.module.css';

interface AppLinkCopy {
  eyebrow: string;
  title: string;
  lede: string;
  cta: string;
  ctaSub: string;
  steps: readonly string[];
  backHome: string;
}

interface AppLinkPageProps {
  copy: AppLinkCopy;
  /** Anything the page adds below the steps, such as the invite's code block. */
  children?: ReactNode;
}

/**
 * Shell shared by /join/<code> and /plan/<id>: nav, title block, get-the-app
 * call to action, steps.
 *
 * Both pages exist for the same reader, the one iOS did not hand over to the
 * app because they do not have it. Only the words differ, and one code block on
 * the invite, so the layout lives here and each page brings its copy.
 */
export default function AppLinkPage({ copy, children }: AppLinkPageProps) {
  return (
    <main className={styles.page}>
      <nav className={styles.nav}>
        <Link href="/" className={`serif ${styles.wordmark}`}>
          Planazo
        </Link>
        <Link href="/" className={styles.navBack}>
          {copy.backHome}
        </Link>
      </nav>

      <p className={styles.eyebrow}>{copy.eyebrow}</p>
      <h1 className={`serif ${styles.title}`}>{copy.title}</h1>
      <p className={styles.lede}>{copy.lede}</p>

      <div className={styles.ctaBlock}>
        <a className={styles.btnInk} href={GET_APP_URL}>
          {copy.cta}
        </a>
        <p className={styles.ctaSub}>{copy.ctaSub}</p>
      </div>

      <ol className={styles.steps}>
        {copy.steps.map((step) => (
          <li key={step} className={styles.step}>
            {step}
          </li>
        ))}
      </ol>

      {children}
    </main>
  );
}
