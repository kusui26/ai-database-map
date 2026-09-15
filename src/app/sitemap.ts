import type { MetadataRoute } from 'next'

// 検索エンジンに渡す索引。公開しているのは地図アプリ本体（`/`）と、
// 「あなたの Claude から使う」導入ページ（`/ai`）の 2 つだけ。
// `/api/*` は機械向けで、`/ai` から辿れる短命 URL も含むので載せない。
//
// 基点は layout.tsx と同じ解決順（本番 URL → Vercel の本番ドメイン → localhost）。
// ここを間違えるとプレビュー環境の URL が索引に載るので、環境変数から決める。
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'http://localhost:3000')

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date()
  return [
    { url: SITE_URL, lastModified, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/ai`, lastModified, changeFrequency: 'monthly', priority: 0.8 },
  ]
}
