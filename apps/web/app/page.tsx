import PlanDemo from '@/components/PlanDemo';
import { BASE, CIRCLE_DOTS, CIRCLES, COPY, LANG, RESOLVED, THREAD } from '@/lib/copy';
import { CONTACT_EMAIL, GET_APP_URL } from '@/lib/links';
import styles from './page.module.css';

export default function Home() {
  const lang = LANG;
  const t = COPY[lang];

  return (
    <>
      <nav className={`shell ${styles.nav}`}>
        <span className={`serif ${styles.wordmark}`}>Planazo</span>
        <a className={styles.navCta} href={GET_APP_URL}>
          {t.navCta}
        </a>
      </nav>

      <header className={styles.hero}>
        <p className={styles.eyebrow}>
          <span className={styles.eyebrowDot} aria-hidden />
          {t.eyebrow}
        </p>
        {/* Two blocks rather than a <br>: balance only works per block, and
            across a <br> it stranded the last word on its own line. */}
        <h1 className={`serif ${styles.heroTitle}`}>
          <span className={styles.heroLine}>{t.heroA}</span>
          <span className={`${styles.heroLine} ${styles.heroAccent}`}>{t.heroB}</span>
        </h1>
        <p className={styles.heroSub}>{t.heroSub}</p>
      </header>

      <section id="demo" className={styles.demoSection}>
        <PlanDemo lang={lang} />

        <div className={styles.heroCtaBlock}>
          <a className={styles.btnInk} href={GET_APP_URL}>
            {t.heroCta}
          </a>
          <p className={styles.heroCtaSub}>{t.heroCtaSub}</p>
        </div>
      </section>

      {/* The pitch: an unresolved thread beside the same question, answered. */}
      <section className={styles.proof}>
        <div className="shell">
          <h2 className={`serif ${styles.sectionTitle} ${styles.proofTitle}`}>{t.proofTitle}</h2>

          <div className={styles.proofGrid}>
            <div className={styles.proofCol}>
              <p className={styles.label}>{t.before}</p>
              <div className={styles.thread}>
                {THREAD[lang].map(([text, mine], i) => (
                  <p
                    key={i}
                    className={styles.bubble}
                    data-mine={mine ? '' : undefined}
                    style={{ opacity: 1 - i * 0.13 }}
                  >
                    {text}
                  </p>
                ))}
                <p className={styles.threadEnd}>{t.threadEnd}</p>
              </div>
            </div>

            <div className={styles.proofCol}>
              <p className={`${styles.label} ${styles.labelAccent}`}>{t.after}</p>
              <div className={styles.resolvedCard}>
                {/* The same idea as the dead thread beside it, but resolved. */}
                <div className={styles.resolvedHead}>
                  <p className={styles.resolvedCircle}>{t.proofCircle}</p>
                  <p className={`serif ${styles.resolvedTitle}`}>{t.flexTitle}</p>
                  <p className={styles.planWhen}>{t.proofWhen}</p>
                </div>

                <p className={styles.confirmed}>{t.confirmed}</p>

                <ul className={styles.answerList}>
                  {RESOLVED[lang].map(([name, answer], i) => {
                    const tone = BASE[(i + 1) % 5];
                    return (
                      <li key={name} className={styles.answerItem}>
                        <span
                          className={styles.answerAvatar}
                          style={{ background: tone.bg, color: tone.fg }}
                          aria-hidden
                        >
                          {name.slice(0, 1)}
                        </span>
                        <span className={styles.answerName}>{name}</span>
                        <span className={styles.answerValue} data-declined={i === 2 ? '' : undefined}>
                          {answer}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.circles}>
        <div className="shell">
          <div className={styles.circlesHead}>
            <p className={`${styles.label} ${styles.labelPink}`}>{t.circlesEyebrow}</p>
            <h2 className={`serif ${styles.sectionTitle} ${styles.circlesTitle}`}>
              {t.circlesTitle}
            </h2>
          </div>

          <div className={styles.circleRow}>
            {CIRCLES[lang].map((c, i) => (
              <article key={c.name} className={styles.circleCard} data-index={i}>
                <span className={styles.circleSwatch} style={{ background: CIRCLE_DOTS[i] }} />
                <div className={styles.circleText}>
                  <h3 className={`serif ${styles.circleName}`}>{c.name}</h3>
                  <p className={styles.circleVibe}>{c.vibe}</p>
                </div>
                <div className={styles.circleMeta}>
                  <span className={styles.circlePeople}>{c.people}</span>
                  <span className={styles.circleNext}>{c.next}</span>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="shell">
        <div className={styles.close}>
          <h2 className={`serif ${styles.closeTitle}`}>{t.closeTitle}</h2>
          <p className={styles.closeSub}>{t.closeSub}</p>
          <div className={styles.closeActions}>
            <a className={styles.btnOrange} href={GET_APP_URL}>
              {t.closeCta}
            </a>
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={`shell ${styles.footerInner}`}>
          <span className={`serif ${styles.footerMark}`}>Planazo</span>
          <div className={styles.footerLinks}>
            {/* TODO: real /privacy and /terms pages are required before store submission. */}
            <a href="#">{t.fPrivacy}</a>
            <a href="#">{t.fTerms}</a>
            <a href={`mailto:${CONTACT_EMAIL}`}>{t.fContact}</a>
          </div>
        </div>
      </footer>
    </>
  );
}
