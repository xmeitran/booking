import type { Metadata } from 'next';
import { Be_Vietnam_Pro, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const sans = Be_Vietnam_Pro({ subsets: ['latin', 'vietnamese'], weight: ['400', '500', '600'], variable: '--font-be-vietnam' });
const mono = JetBrains_Mono({ subsets: ['latin', 'vietnamese'], weight: ['400', '500'], variable: '--font-jetbrains' });

export const metadata: Metadata = { title: 'Booking Hub' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
