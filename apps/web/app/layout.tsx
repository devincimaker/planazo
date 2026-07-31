import type { Metadata } from 'next';
import { Instrument_Sans, Young_Serif } from 'next/font/google';

import { LANG, META } from '@/lib/copy';
import { SITE_URL } from '@/lib/links';
import './globals.css';

const sans = Instrument_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

const serif = Young_Serif({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-serif',
  display: 'swap',
});

const meta = META[LANG];

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: meta.title,
  description: meta.description,
  openGraph: {
    title: meta.title,
    description: meta.description,
    url: SITE_URL,
    siteName: 'Planazo',
    locale: LANG === 'es' ? 'es_ES' : 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: meta.title,
    description: meta.description,
  },
};

export const viewport = {
  themeColor: '#ede7e0',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang={LANG} className={`${sans.variable} ${serif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
