/**
 * キャッシュ指示（`src/lib/http.ts` の `CACHE`）を固定する。
 *
 * ここは**ヘッダの文字列を揃える**話ではなく、**誰にどれだけ持たせてよいか**の約束である。
 * とくに 2 つ。
 *
 * ① **ブラウザの寿命は CDN より短い。** CDN はパージできるが、配ってしまったブラウザの
 *    キャッシュは消せない。逆転すると、データを差し替えたのに古い値が長く残る。
 * ② **`short` には `max-age` を付けない。** そこには「いまの警報」がいる。
 *    古い警報を「今」として見せるのは、転送量の節約と釣り合わない（260824_flood §7.4）。
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CACHE } from '@/lib/http'

/** `public, max-age=3600, s-maxage=86400` → { public: null, 'max-age': 3600, … }。 */
function directives(header: string): ReadonlyMap<string, number | null> {
  const parts = header.split(',').map((part) => part.trim())
  return new Map(
    parts.map((part) => {
      const [name, value] = part.split('=')
      return [name ?? '', value === undefined ? null : Number(value)]
    }),
  )
}

/** ルートのソース（どの段を使っているかを、定数ではなく実際の口で見る）。 */
function routeSource(path: string): string {
  return readFileSync(`${process.cwd()}/src/app/api/${path}/route.ts`, 'utf-8')
}

const CACHEABLE = ['day', 'hour'] as const

describe('ブラウザ向けの寿命（max-age）', () => {
  it('キャッシュしてよい段には付いている（付けないと毎回取り直しになる）', () => {
    for (const tier of CACHEABLE) {
      expect(directives(CACHE[tier]).get('max-age'), tier).toBeGreaterThan(0)
    }
  })

  it('CDN の寿命より短い（配ったブラウザのキャッシュは消せないので）', () => {
    for (const tier of CACHEABLE) {
      const parsed = directives(CACHE[tier])
      expect(parsed.get('max-age'), tier).toBeLessThan(parsed.get('s-maxage') ?? 0)
    }
  })

  it('共有キャッシュに載せてよいと明示している', () => {
    for (const tier of CACHEABLE) {
      expect(directives(CACHE[tier]).has('public'), tier).toBe(true)
    }
  })
})

describe('CDN 向けの寿命（s-maxage）は変えない', () => {
  it('段ごとの値が据え置かれている', () => {
    expect(directives(CACHE.day).get('s-maxage')).toBe(86400)
    expect(directives(CACHE.hour).get('s-maxage')).toBe(3600)
    expect(directives(CACHE.short).get('s-maxage')).toBe(30)
  })

  it('stale-while-revalidate も据え置かれている', () => {
    expect(directives(CACHE.day).get('stale-while-revalidate')).toBe(3600)
    expect(directives(CACHE.hour).get('stale-while-revalidate')).toBe(600)
    expect(directives(CACHE.short).get('stale-while-revalidate')).toBe(60)
  })
})

describe('「いま」を配り置きしない', () => {
  it('short にブラウザ向けの寿命は無い', () => {
    expect(directives(CACHE.short).has('max-age')).toBe(false)
  })

  it('いまの警報は short を使っている（ここが day に変わったら上の約束が崩れる）', () => {
    expect(routeSource('hazard/alerts')).toContain('CACHE.short')
    expect(routeSource('hazard/alerts')).not.toContain('CACHE.day')
  })

  it('地点ハザードは、欠けた答えだけ short に落とす', () => {
    // 完全な答えは 1 日、外部が欠けた答えは 30 秒（長く配らない）。
    const source = routeSource('hazard/point')
    expect(source).toContain('CACHE.day')
    expect(source).toContain('CACHE.short')
  })
})

describe('保存させない段', () => {
  it('none は no-store だけ（他の指示を混ぜない）', () => {
    expect(CACHE.none).toBe('no-store')
  })
})

describe('いちばん重い応答に、ブラウザ向けの寿命が効く', () => {
  it('全駅 geojson は day を使っている（227KB・地図を開くたびに流れていた）', () => {
    expect(routeSource('stations/geojson')).toContain('CACHE.day')
  })
})
