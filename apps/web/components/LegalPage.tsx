import Link from 'next/link';

import { LANG } from '@/lib/copy';
import { LAST_UPDATED, type Section } from '@/lib/legal';
import styles from '@/app/legal.module.css';

interface LegalPageProps {
  title: string;
  lede: string;
  updatedLabel: string;
  backHome: string;
  sections: Section[];
  /** The sibling prose page, linked from the footer */
  sibling: { href: string; label: string };
}

/** Shell shared by /privacy and /support — nav, title block, sections, footer. */
export default function LegalPage({
  title,
  lede,
  updatedLabel,
  backHome,
  sections,
  sibling,
}: LegalPageProps) {
  return (
    <main className={styles.page}>
      <nav className={styles.nav}>
        <Link href="/" className={`serif ${styles.wordmark}`}>
          Planazo
        </Link>
        <Link href="/" className={styles.navBack}>
          {backHome}
        </Link>
      </nav>

      <h1 className={`serif ${styles.title}`}>{title}</h1>
      <p className={styles.updated}>
        {updatedLabel} · {LAST_UPDATED[LANG]}
      </p>
      <p className={styles.lede}>{lede}</p>

      <hr className={styles.rule} />

      {sections.map((section) => (
        <section key={section.heading} className={styles.section}>
          <h2 className={`serif ${styles.heading}`}>{section.heading}</h2>

          {section.paras?.map((para) => (
            <p key={para} className={styles.para}>
              {para}
            </p>
          ))}

          {section.bullets ? (
            <ul className={styles.bullets}>
              {section.bullets.map((bullet) => (
                <li key={bullet.term} className={styles.bullet}>
                  <p className={styles.term}>{bullet.term}</p>
                  <p className={styles.detail}>{bullet.detail}</p>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}

      <footer className={styles.footer}>
        <Link href={sibling.href}>{sibling.label}</Link>
        <Link href="/">{backHome}</Link>
      </footer>
    </main>
  );
}
