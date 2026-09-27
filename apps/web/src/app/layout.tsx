import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { anek, plexMono } from '../lib/fonts';
import { siteMetadata } from '../lib/site-metadata';
import './globals.css';

const origin = process.env.APP_ORIGIN;

export const metadata: Metadata = {
  // share cards need absolute URLs; the origin is validated at startup, so tolerate its absence here
  ...(origin !== undefined && URL.canParse(origin) ? { metadataBase: new URL(origin) } : {}),
  title: siteMetadata.name,
  description: siteMetadata.description,
  applicationName: siteMetadata.name,
  openGraph: {
    title: `${siteMetadata.name} — ${siteMetadata.tagline}`,
    description: siteMetadata.description,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${siteMetadata.name} — ${siteMetadata.tagline}`,
    description: siteMetadata.description,
  },
};

export const viewport: Viewport = {
  themeColor: '#0b0e19',
  colorScheme: 'light dark',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${anek.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
