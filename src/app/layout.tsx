import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import './globals.css'

const DESCRIPTION =
  'オープンデータ（乗降客数・人口・地価・バス・事業所…）を駅×半径で集約し、地図とAIで誰でも使えるようにするWebアプリ。'

// OG/canonical の基点。本番は NEXT_PUBLIC_SITE_URL、Vercel は本番URL、無ければ localhost。
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'http://localhost:3000')

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'AI Database Map — 駅×半径のオープンデータ地図',
    template: '%s | AI Database Map',
  },
  description: DESCRIPTION,
  applicationName: 'AI Database Map',
  keywords: [
    'オープンデータ',
    '駅',
    '乗降客数',
    '人口',
    '地価',
    'バス',
    '商圏分析',
    'GIS',
    '地図',
    'MapLibre',
  ],
  authors: [{ name: 'AI Database Map' }],
  robots: { index: true, follow: true },
  openGraph: {
    type: 'website',
    locale: 'ja_JP',
    siteName: 'AI Database Map',
    title: 'AI Database Map — 駅×半径のオープンデータ地図',
    description: DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AI Database Map',
    description: DESCRIPTION,
  },
}

export const viewport: Viewport = {
  themeColor: '#4f46e5',
  colorScheme: 'light',
  width: 'device-width',
  initialScale: 1,
  // 地図アプリだが a11y のためズームは禁止しない（maximumScale を制限しない）
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ja">
      <body className="min-h-full bg-slate-50 text-slate-900 antialiased">
        {/* 地図タイル（地理院）への接続を先行（LCP 短縮）。React が head へ巻き上げる。 */}
        <link rel="preconnect" href="https://cyberjapandata.gsi.go.jp" crossOrigin="anonymous" />
        <NuqsAdapter>{children}</NuqsAdapter>
      </body>
    </html>
  )
}
