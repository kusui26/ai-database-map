import type { MetadataRoute } from 'next'

// クローラ向けの方針。`/api/*` は機械向けの口で、`build_dataset` / `render_map` が返す
// **署名つき短命 URL**（24 時間で失効）もこの下にある。索引に載っても意味が無く、
// 失効後は 410 を返すだけなので明示的に外す。
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'http://localhost:3000')

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: '/api/' }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
