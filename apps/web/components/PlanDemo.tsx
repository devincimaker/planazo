'use client';

import { useState } from 'react';

import { BASE, COPY, DATES, FULL_GOERS, MIN_PEOPLE, type Avatar, type Lang } from '@/lib/copy';
import styles from './PlanDemo.module.css';

function Avatars({ people }: { people: Avatar[] }) {
  return (
    <div className={styles.avatars} aria-hidden>
      {people.map((p, i) => (
        <div
          key={`${p.i}-${i}`}
          className={styles.avatar}
          // Leftmost on top, so the wider "you" chip isn't clipped by its neighbour.
          style={{ background: p.bg, color: p.fg, zIndex: people.length - i }}
        >
          {p.i}
        </div>
      ))}
    </div>
  );
}

/** Fixed-date plan: one date, a yes/no answer, a filling progress bar. */
function FixedCard({ t }: { t: (typeof COPY)[Lang] }) {
  const [answer, setAnswer] = useState<'in' | 'out' | null>(null);
  const isIn = answer === 'in';

  const goers = isIn
    ? [{ i: t.you, bg: '#F2542D', fg: '#FFFFFF' }, ...BASE.slice(0, 4), BASE[5]]
    : BASE;

  return (
    <article className={`${styles.card} ${styles.cardFixed}`}>
      <div className={styles.cardTop}>
        <div className={styles.cardHead}>
          <div className={styles.circleLabel}>
            <span className={styles.circleDot} style={{ background: 'var(--pink)' }} />
            <span>{t.circleFixed}</span>
          </div>
          <span className={styles.host}>{t.hosted}</span>
        </div>

        <div className={styles.titleBlock}>
          <h3 className={`serif ${styles.planTitle}`}>{t.planTitle}</h3>
          <p className={styles.planWhen}>{t.planWhen}</p>
        </div>

        <div className={styles.progressBlock}>
          <div className={styles.track}>
            <div className={styles.fill} style={{ width: isIn ? '70%' : '60%' }} />
          </div>
          <div className={styles.goersRow}>
            <Avatars people={goers} />
            <span className={styles.slots}>{isIn ? t.slotsIn : t.slots}</span>
          </div>
        </div>
      </div>

      <div className={styles.cardFoot}>
        {answer === null ? (
          <div className={styles.answerRow}>
            <button type="button" className={styles.btnGhost} onClick={() => setAnswer('out')}>
              {t.cant}
            </button>
            <button type="button" className={styles.btnPrimary} onClick={() => setAnswer('in')}>
              {t.imIn}
            </button>
          </div>
        ) : (
          <div className={styles.statusPill} data-in={isIn ? '' : undefined}>
            <span className={styles.statusLabel}>{isIn ? t.inLabel : t.outLabel}</span>
            <button type="button" className={styles.linkBtn} onClick={() => setAnswer(null)}>
              {t.change}
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

/** Flexible plan: tick every night that works, watch a winner emerge and lock. */
function FlexibleCard({ t, lang }: { t: (typeof COPY)[Lang]; lang: Lang }) {
  const [picked, setPicked] = useState<string[]>([]);

  const toggle = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const rows = DATES[lang].map((d) => ({ ...d, n: d.base + (picked.includes(d.id) ? 1 : 0) }));
  const top = Math.max(...rows.map((r) => r.n));
  const winner = rows.find((r) => r.n === top)!;
  const locked = top >= MIN_PEOPLE;

  return (
    <article className={styles.card}>
      <div className={styles.cardTop}>
        <div className={styles.cardHead}>
          <div className={styles.circleLabel}>
            <span className={styles.circleDot} style={{ background: 'var(--sage)' }} />
            <span>{t.circleFlex}</span>
          </div>
          <span className={`${styles.tag} ${styles.tagFlex}`}>{t.flexTag}</span>
        </div>

        <div className={styles.titleBlock}>
          <h3 className={`serif ${styles.planTitle}`}>{t.flexTitle}</h3>
          <p className={styles.planWhen}>{t.flexAsk}</p>
        </div>
      </div>

      <div className={styles.dateList}>
        {rows.map((r) => {
          const mine = picked.includes(r.id);
          const lead = r.id === winner.id;
          const hot = locked && lead;

          return (
            <button
              key={r.id}
              type="button"
              className={styles.dateRow}
              data-mine={mine ? '' : undefined}
              data-lead={lead ? '' : undefined}
              data-hot={hot ? '' : undefined}
              aria-pressed={mine}
              onClick={() => toggle(r.id)}
            >
              <span className={styles.dateBox} aria-hidden>
                {mine ? '✓' : ''}
              </span>
              <span className={styles.dateText}>
                <span className={styles.dateLabel}>{r.label}</span>
                <span className={styles.dateSub}>
                  {mine
                    ? `${r.time} · ${t.youToo}`
                    : lead
                      ? `${r.time} · ${t.leading}`
                      : r.time}
                </span>
              </span>
              <span className={styles.dateCount}>
                {r.n} {t.canDo}
              </span>
            </button>
          );
        })}

        <p className={styles.lockNote} data-locked={locked ? '' : undefined} aria-live="polite">
          {locked ? `${t.lockedIn} ${winner.label}, ${winner.time}` : t.lockOpen}
        </p>
      </div>
    </article>
  );
}

/** Full plan: nothing to answer, but the waitlist is one tap. */
function FullCard({ t }: { t: (typeof COPY)[Lang] }) {
  const [waiting, setWaiting] = useState(false);

  return (
    <article className={`${styles.card} ${styles.cardFull}`}>
      <div className={styles.cardTop}>
        <div className={styles.cardHead}>
          <div className={styles.circleLabel}>
            <span className={styles.circleDot} style={{ background: 'var(--ink)' }} />
            <span>{t.circleFull}</span>
          </div>
          <span className={`${styles.tag} ${styles.tagFull}`}>{t.fullTag}</span>
        </div>

        <div className={styles.titleBlock}>
          <h3 className={`serif ${styles.planTitle}`}>{t.fullTitle}</h3>
          <p className={styles.planWhen}>{t.fullWhen}</p>
        </div>

        <div className={styles.progressBlock}>
          <div className={styles.trackFull} />
          <div className={styles.goersRow}>
            <Avatars people={FULL_GOERS} />
            <span className={styles.slotsMuted}>{t.fullSlots}</span>
          </div>
        </div>
      </div>

      <div className={styles.cardFootStack}>
        {waiting ? (
          <div className={styles.waitPill}>
            <span className={styles.waitLabel}>{t.waitOn}</span>
            <button type="button" className={styles.linkBtn} onClick={() => setWaiting(false)}>
              {t.change}
            </button>
          </div>
        ) : (
          <button type="button" className={styles.btnOutline} onClick={() => setWaiting(true)}>
            {t.waitCta}
          </button>
        )}
        <p className={styles.waitNote} aria-live="polite">
          {waiting ? t.waitNoteOn : t.waitNoteOff}
        </p>
      </div>
    </article>
  );
}

export default function PlanDemo({ lang }: { lang: Lang }) {
  const t = COPY[lang];

  return (
    <div className={styles.deck}>
      <FixedCard t={t} />
      <FlexibleCard t={t} lang={lang} />
      <FullCard t={t} />
    </div>
  );
}
