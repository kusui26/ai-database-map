/**
 * ハザードのルートが**上流を守っている**か（`docs/260916_ops_guard.md` G5）。
 *
 * 守っているのは自分のサーバではなく、気象庁と国土地理院である。CDN は効くが、
 * **座標が 1 つ違えば別のキャッシュキー**なので、地図の上を機械的になぞられると、
 * そのまま上流への取得になる。同じ上流を MCP 側は 10〜15 回/分に絞っているのに、
 * ブラウザ側が無制限だった——**口によって posture が食い違っていた**。
 *
 * 検査は**上流に触らずに**行う。窓を先に埋めてから 1 回だけ呼べば、ルートは
 * 検証もデータ取得もせずに 429 を返す（制限が**いちばん手前**にあることの確認でもある）。
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { checkRateLimit, resetRateLimitStore } from '@/ai/rate-limit'
import { GET as alerts } from '@/app/api/hazard/alerts/route'
import { GET as catalog } from '@/app/api/hazard/catalog/route'
import { GET as escape } from '@/app/api/hazard/escape/route'
import { GET as evacuation } from '@/app/api/hazard/evacuation/route'
import { GET as point } from '@/app/api/hazard/point/route'

const WINDOW_MS = 60_000
/** どのルートの上限よりも確実に多い回数（上限の値をテストに焼き込まないため）。 */
const OVER_ANY_LIMIT = 100

type Route = (request: Request) => Promise<Response>

/** 上流を叩くルート（バケツの名前つき）。`catalog` は上流を叩かないので入れない。 */
const UPSTREAM_ROUTES: readonly (readonly [string, string, Route, string])[] = [
  ['point', 'hazard-point', point, 'lon=139.847&lat=35.7645'],
  ['alerts', 'hazard-alerts', alerts, 'lon=139.847&lat=35.7645'],
  ['evacuation', 'hazard-evacuation', evacuation, 'lon=139.847&lat=35.7645&for=flood'],
  ['escape', 'hazard-escape', escape, 'lon=139.847&lat=35.7645&for=flood'],
]

/** その IP の窓を埋める（上流には触れない）。 */
function saturate(bucket: string, ip: string): void {
  for (let index = 0; index < OVER_ANY_LIMIT; index += 1) {
    checkRateLimit(`${bucket}:${ip}`, { limit: 1000, windowMs: WINDOW_MS, now: Date.now() })
  }
}

function call(route: Route, path: string, query: string, ip: string): Promise<Response> {
  return route(
    new Request(`http://localhost/api/${path}?${query}`, { headers: { 'x-real-ip': ip } }),
  )
}

beforeEach(() => {
  resetRateLimitStore()
})

describe('上流を叩くルートには上限がある', () => {
  for (const [name, bucket, route, query] of UPSTREAM_ROUTES) {
    it(`${name}：窓を使い切ると 429（上流には行かない）`, async () => {
      const ip = `10.1.1.1`
      saturate(bucket, ip)
      const response = await call(route, `hazard/${name}`, query, ip)
      expect(response.status).toBe(429)
      const body: unknown = await response.json()
      expect(JSON.stringify(body)).toContain('RATE_LIMITED')
    })

    it(`${name}：待つ秒数を返す（総当たりで叩き直させない）`, async () => {
      const ip = `10.1.1.2`
      saturate(bucket, ip)
      const response = await call(route, `hazard/${name}`, query, ip)
      expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
    })
  }
})

/**
 * ⚠ **通り抜けたことの確認にも、上流を使わない。**
 * 座標を欠いたクエリは検証で 400 になる——制限を通ったが**上流には行っていない**ことの印になる。
 * 上流を守る変更の検査が上流を叩いていては筋が通らない（最初そう書いていた）。
 */
const NO_COORDS = 'placeJa=検証だけ'

describe('制限は検証より手前にある', () => {
  it('窓を使い切っていれば、入力を見る前に 429', async () => {
    const ip = '10.1.1.7'
    saturate('hazard-point', ip)
    // 座標が無いので、通り抜けていれば 400 になるはず。429 が返る＝手前で止めている。
    expect((await call(point, 'hazard/point', NO_COORDS, ip)).status).toBe(429)
  })

  it('窓が空いていれば、いつもどおり入力を見る（400）', async () => {
    expect((await call(point, 'hazard/point', NO_COORDS, '10.1.1.8')).status).toBe(400)
  })
})

describe('バケツはルートごとに独立している', () => {
  it('地点を使い切っても、いまの警報は止まらない', async () => {
    const ip = '10.1.1.3'
    saturate('hazard-point', ip)
    expect((await call(point, 'hazard/point', NO_COORDS, ip)).status).toBe(429)
    // 警報側の窓は空のまま——**同じ相談の続きが、別の理由で止まらない**。
    expect((await call(alerts, 'hazard/alerts', NO_COORDS, ip)).status).toBe(400)
  })

  it('別の IP は巻き込まれない', async () => {
    saturate('hazard-point', '10.1.1.4')
    expect((await call(point, 'hazard/point', NO_COORDS, '10.1.1.5')).status).toBe(400)
  })
})

describe('上流を叩かないルートは制限しない', () => {
  it('カタログは何度呼んでも通る（静的なので守るものが無い）', async () => {
    const ip = '10.1.1.6'
    const statuses = []
    for (let index = 0; index < 25; index += 1) {
      statuses.push((await call(catalog, 'hazard/catalog', '', ip)).status)
    }
    expect(new Set(statuses)).toEqual(new Set([200]))
  })
})
