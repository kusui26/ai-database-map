import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hazardLayersWithPointAnswer } from '@/domain/hazard/catalog'
import { clearOfficialTileCache } from '@/lib/hazard/officialTiles'
import { tileReadings } from '@/lib/hazard/readings'
import { getHazardLayer } from '@/shared/hazard'

/**
 * 公式タイルの読み取りが、**届かなかったレイヤを名前で**返すこと（`docs/261110_fix_PLAN.md` §8.4）。
 *
 * ドメインはこれを「未確認」と言う——区域外とも図なしとも言えないから。
 * 404（その区画にデータが無い）は**届いた**扱い、5xx・タイムアウトは**届かなかった**扱い。
 * `Promise.allSettled` の添字でレイヤに戻しているので、**取り違えない**ことをここで固定する。
 */

const KAMEARI = { lon: 139.847, lat: 35.7645 }
const LAYERS = hazardLayersWithPointAnswer()
const SERVER_ERROR = 500
const NOT_FOUND = 404

/** そのレイヤのタイル URL の頭（`{z}` より前・末尾は `/`）。 */
function tilePrefix(layerKey: string): string {
  const url = getHazardLayer(layerKey)?.tile?.url
  if (url === undefined || url === null) throw new Error(`タイルがありません: ${layerKey}`)
  return url.slice(0, url.indexOf('{z}'))
}

function urlOf(input: string | URL | Request): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

/** 指定したレイヤだけ 500、ほかは 404（この区画にも、この一帯にもデータが無い）を返す。 */
function stubTiles(failingLayerKeys: readonly string[]): void {
  const failing = failingLayerKeys.map(tilePrefix)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request): Promise<Response> => {
      const url = urlOf(input)
      const status = failing.some((prefix) => url.startsWith(prefix)) ? SERVER_ERROR : NOT_FOUND
      return new Response(null, { status })
    }),
  )
}

beforeEach(() => {
  // 404 の結果（null）は覚えられるので、テストごとに忘れさせる。
  clearOfficialTileCache()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('tileReadings：届かなかったレイヤ（unreachedLayerKeys）', () => {
  it('前提：レイヤごとにタイルの URL の頭が違う（URL でレイヤを見分けられる）', () => {
    expect(new Set(LAYERS.map(tilePrefix)).size).toBe(LAYERS.length)
  })

  it('届かなかったレイヤだけを名前で返し、404 は届いた扱い（図なし）にする', async () => {
    stubTiles(['hightide_l2'])
    const result = await tileReadings(KAMEARI.lon, KAMEARI.lat)
    expect(result.unreachedLayerKeys).toEqual(['hightide_l2'])
    expect(result.uncoveredLayerKeys).toEqual(LAYERS.filter((key) => key !== 'hightide_l2'))
    expect(result.reached).toBe(true)
    expect(result.noteJa).toBe('公式タイルを 1 レイヤぶん取得できませんでした')
  })

  it('複数でも取り違えない（カタログの順で返す）', async () => {
    stubTiles(['jisuberi', 'flood_l1'])
    const result = await tileReadings(KAMEARI.lon, KAMEARI.lat)
    expect(result.unreachedLayerKeys).toEqual(['flood_l1', 'jisuberi'])
    expect(result.noteJa).toBe('公式タイルを 2 レイヤぶん取得できませんでした')
  })

  it('どれにも届かなければ全レイヤ（そのときは reached: false）', async () => {
    stubTiles(LAYERS)
    const result = await tileReadings(KAMEARI.lon, KAMEARI.lat)
    expect(result.unreachedLayerKeys).toEqual(LAYERS)
    expect(result.uncoveredLayerKeys).toEqual([])
    expect(result.reached).toBe(false)
  })

  it('すべて届けば空（注記も出さない）', async () => {
    stubTiles([])
    const result = await tileReadings(KAMEARI.lon, KAMEARI.lat)
    expect(result.unreachedLayerKeys).toEqual([])
    expect(result.noteJa).toBeNull()
  })
})
