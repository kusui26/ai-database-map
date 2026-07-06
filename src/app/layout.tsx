import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'

export const metadata: Metadata = {
  title: 'AI Database Map',
  description:
    'オープンデータ（乗降客数・人口・地価・バス・事業所…）を駅×半径で集約し、地図とAIで誰でも使えるようにするWebアプリ。',
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ja">
      <body className="min-h-full bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  )
}
