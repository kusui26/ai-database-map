/**
 * 導入ページ `/ai` の約束を固定する。
 *
 * このページは**カタログ掲載が閉じた以上、唯一の入口**なので（`docs/260915_week5_…` §2）、
 * 並び替えや文言の差し替えで「読者に届く」性質が静かに失われないようにする。
 * ここで落ちるのは見た目の好みではなく、**設計判断が戻されたとき**だけにしてある。
 */

import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE_PATH = `${process.cwd()}/src/app/ai/page.tsx`
const PAGE = readFileSync(PAGE_PATH, 'utf-8')
const OG_PATH = `${process.cwd()}/src/app/ai/opengraph-image.tsx`

/** `<Section title="…">` の並び。ページ上の見出し順と一致する。 */
function sectionTitles(): string[] {
  return [...PAGE.matchAll(/<Section title="([^"]+)"/g)].map((entry) => entry[1] ?? '')
}

/** コメントを落とした本文（OG 画像に描かれる文字列だけを見るため）。 */
function codeWithoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('導入ページ /ai', () => {
  it('理由が導入手順より先に来る（冷たい読者は「なぜ」を先に要る）', () => {
    const titles = sectionTitles()
    const example = titles.findIndex((title) => title.includes('こう返ってきます'))
    const useCases = titles.findIndex((title) => title.includes('3 つの使い方'))
    const install = titles.findIndex((title) => title.includes('Claude Code'))
    expect(example).toBeGreaterThanOrEqual(0)
    expect(useCases).toBeGreaterThan(example)
    expect(install).toBeGreaterThan(useCases)
  })

  it('実例は作文ではなく、実走の抜粋だと明示している', () => {
    // 数字を載せる以上、どこから来た数字かを言う。言えない数字は載せない。
    expect(PAGE).toContain('実際の応答からの抜粋')
    expect(PAGE).toContain('golden')
    // 順位が固定されていると読ませない（重みは質問者の条件で変わる）。
    expect(PAGE).toContain('順位が固定されているわけではありません')
  })

  it('実例が「弱点」と「限界」まで見せている（良い面だけを見せない）', () => {
    expect(PAGE).toContain('弱点')
    expect(PAGE).toContain('地価公示')
    expect(PAGE).toContain('所要時間データを持たない')
  })

  it('共有カードが /ai 専用にある（ルートの地図アプリ用ではない）', () => {
    expect(existsSync(OG_PATH)).toBe(true)
    expect(PAGE).toContain("alternates: { canonical: '/ai' }")
    expect(PAGE).toContain('openGraph:')
  })

  it('OG 画像に日本語を入れない（Satori の既定フォントが豆腐にする）', () => {
    const drawn = codeWithoutComments(readFileSync(OG_PATH, 'utf-8'))
    expect(drawn).not.toMatch(/[぀-ヿ一-鿿]/)
  })
})

describe('索引（sitemap / robots）', () => {
  const SITEMAP = readFileSync(`${process.cwd()}/src/app/sitemap.ts`, 'utf-8')
  const ROBOTS = readFileSync(`${process.cwd()}/src/app/robots.ts`, 'utf-8')

  it('載せるのは地図アプリと /ai の 2 つだけ', () => {
    expect(SITEMAP).toContain('/ai')
    // `/api/*` には署名つき短命 URL がぶら下がる。索引に載せる意味が無い。
    expect(SITEMAP).not.toContain("'/api")
    expect(ROBOTS).toContain("disallow: '/api/'")
  })

  it('基点は環境変数から決める（プレビュー URL を索引に載せない）', () => {
    for (const source of [SITEMAP, ROBOTS]) {
      expect(source).toContain('NEXT_PUBLIC_SITE_URL')
      expect(source).toContain('VERCEL_PROJECT_PRODUCTION_URL')
    }
  })
})
