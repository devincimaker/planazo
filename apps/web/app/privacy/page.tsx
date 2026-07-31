import type { Metadata } from 'next';

import LegalPage from '@/components/LegalPage';
import { LANG } from '@/lib/copy';
import { PRIVACY, SUPPORT } from '@/lib/legal';

const doc = PRIVACY[LANG];

export const metadata: Metadata = {
  title: `${doc.title} · Planazo`,
  description: doc.lede,
  alternates: { canonical: '/privacy' },
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title={doc.title}
      lede={doc.lede}
      updatedLabel={doc.updatedLabel}
      backHome={doc.backHome}
      sections={doc.sections}
      sibling={{ href: '/support', label: SUPPORT[LANG].title }}
    />
  );
}
