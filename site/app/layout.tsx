import type { Metadata } from 'next';
import { Big_Shoulders, IBM_Plex_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const SITE_URL = 'https://quarry-mev.vercel.app';

// Industrial signage display — heavy weight only, chiseled feel.
const bigShoulders = Big_Shoulders({
  subsets: ['latin'],
  weight: ['500', '700', '900'],
  variable: '--font-display',
  display: 'swap',
});

// Body — taut technical sans, two weights only.
const plex = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-sans',
  display: 'swap',
});

// Surveyor-tablet readouts.
const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Quarry',
  description:
    "Hybrid MEV arbitrage engine. TypeScript scanner watches Ethereum's mempool, Yul executor runs a two-hop cross-DEX arb in 188 bytes of bytecode. Aave V3 flashloans, 99.89% prediction accuracy on forked mainnet.",
  metadataBase: new URL(SITE_URL),
  openGraph: {
    title: 'Quarry',
    description:
      '188 bytes of Yul. 110k gas on real Uniswap V2 + Sushiswap pools. Aave V3 flashloans, no inventory required.',
    url: SITE_URL,
    siteName: 'Quarry',
    images: [{ url: '/banner-dark.png', width: 1200, height: 420 }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Quarry',
    description: '188 B Yul. 110k gas. Aave V3 flashloans.',
    images: ['/banner-dark.png'],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${bigShoulders.variable} ${plex.variable} ${jetbrains.variable}`}>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
