/**
 * エリアの図を開いた直後のエリア（`src/domain/area-summary/locate.ts`・共通 API `GET /api/areas/locate`・2026-10-15 B5e・
 * `docs/261001_fix_user_feedback_ui.md` §6.12.10）。
 *
 * 固定すること：
 * - 選択中の駅 → その駅の市区町村（政令市は区）。地図の範囲より先に見る
 * - 地図の範囲 → 中心に最も近い駅で、寄り方に合わせて市区町村（縦横の長い方が 50km 以下）・都道府県（「このあたり」と言える広さ）・
 *   全国（日本全体に近い）。広さの境目は B3 の「このあたり」「この区」と同じ定数
 * - 決めた手がかりを言葉で返す（図が「なぜこのエリアか」を出す）
 * - 知らない駅は 404、範囲の形が崩れていれば・手がかりが無ければ 400（黙って全国にしない）
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type CatalogStation } from '@/db/queries'
import { clearAreaCache } from '@/ai/area/catalog'
import { locateArea, type LocatableStation } from '@/domain/area-summary/locate'
import { MAP_VIEW_MAX_LON_SPAN_DEG, MAP_WARD_MAX_SPAN_KM } from '@/domain/map/view-scale'
import { CACHE } from '@/lib/http'
import { areaLocateResponseSchema } from '@/shared/area-summary'
import { type Viewport } from '@/shared/viewport'
import { AREA_STATIONS, TOKYO_VIEW } from './fixtures/area-catalog'

const db = vi.hoisted(() => ({ stationCatalog: vi.fn() }))

vi.mock('@/db/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/queries')>()
  return { ...actual, ...db }
})

const { GET } = await import('@/app/api/areas/locate/route')

const STATIONS: ReadonlyMap<string, LocatableStation> = new Map(
  AREA_STATIONS.map((station) => [station.grp, station]),
)

/** 竹橋の周り（約 7km 四方・中心は竹橋の 200m ほど南西）。 */
const TAKEBASHI_VIEW: Viewport = { west: 139.72, south: 35.66, east: 139.8, north: 35.72 }
/** 日本全体。 */
const JAPAN_VIEW: Viewport = { west: 122.9, south: 24.0, east: 153.9, north: 45.6 }
/** 緯度 1 度の長さ（km・`view-scale.ts` の地球の半径と同じ近似）。 */
const KM_PER_LAT_DEG = (6371 * Math.PI) / 180
const TAKEBASHI_LON = 139.75852
const TAKEBASHI_LAT = 35.69028

/** 竹橋を中心に、縦が `heightKm` の細長い範囲（横は 1km ほど・縦の長さだけで寄り方が決まる）。 */
function tallViewAroundTakebashi(heightKm: number): Viewport {
  const halfLat = heightKm / KM_PER_LAT_DEG / 2
  return {
    west: TAKEBASHI_LON - 0.005,
    south: TAKEBASHI_LAT - halfLat,
    east: TAKEBASHI_LON + 0.005,
    north: TAKEBASHI_LAT + halfLat,
  }
}

function station(overrides: Partial<CatalogStation>): CatalogStation {
  return {
    grp: 'テスト#0',
    name: 'テスト',
    label: 'テスト',
    prefecture: '東京都',
    municipality: null,
    municipalityCode: null,
    lon: TAKEBASHI_LON,
    lat: TAKEBASHI_LAT,
    paxLatest: null,
    ...overrides,
  }
}

describe('locateArea：選択中の駅', () => {
  it('その駅の市区町村（政令市は区）', () => {
    expect(locateArea({ kind: 'station', grp: '新横浜#0' }, STATIONS)).toEqual({
      ok: true,
      area: { ref: 'muni:14109', basisJa: '選択中の駅（新横浜）の市区町村' },
    })
  })

  it('同じ名前の駅は、見分けのつく表示名で手がかりを書く', () => {
    const result = locateArea({ kind: 'station', grp: '府中#0' }, STATIONS)
    expect(result).toEqual({
      ok: true,
      area: { ref: 'muni:13206', basisJa: '選択中の駅（府中（京王電鉄））の市区町村' },
    })
  })

  it('市区町村の分からない駅は都道府県', () => {
    const lonely = station({ grp: '孤島#0', label: '孤島', prefecture: '東京都' })
    const result = locateArea({ kind: 'station', grp: '孤島#0' }, new Map([[lonely.grp, lonely]]))
    expect(result).toEqual({
      ok: true,
      area: { ref: 'pref:13', basisJa: '選択中の駅（孤島）の都道府県' },
    })
  })

  it('都道府県も分からなければ全国（知らない名前を都道府県の文字列にしない）', () => {
    const odd = station({ grp: '謎#0', label: '謎', prefecture: 'どこか県' })
    const result = locateArea({ kind: 'station', grp: '謎#0' }, new Map([[odd.grp, odd]]))
    expect(result.ok && result.area.ref).toBe('jp')
  })

  it('知らない駅は理由を返す（黙って地図の範囲や全国にしない）', () => {
    expect(locateArea({ kind: 'station', grp: 'nope#0' }, STATIONS)).toEqual({
      ok: false,
      messageJa: '駅が見つかりません: nope#0',
    })
  })
})

describe('locateArea：地図の見えている範囲', () => {
  it('区が主役の寄り方なら、中心に近い駅の市区町村', () => {
    expect(locateArea({ kind: 'view', viewport: TAKEBASHI_VIEW }, STATIONS)).toEqual({
      ok: true,
      area: { ref: 'muni:13101', basisJa: '地図の中心に近い駅（竹橋）の市区町村' },
    })
  })

  it('首都圏の初期表示（約 180km）は都道府県（千代田区を選ばない）', () => {
    const result = locateArea({ kind: 'view', viewport: TOKYO_VIEW }, STATIONS)
    expect(result.ok && result.area.ref).toBe('pref:13')
    expect(result.ok && result.area.basisJa).toMatch(/^地図の中心に近い駅（.+）の都道府県$/)
  })

  it('日本全体に近い広さは全国', () => {
    expect(locateArea({ kind: 'view', viewport: JAPAN_VIEW }, STATIONS)).toEqual({
      ok: true,
      area: { ref: 'jp', basisJa: '地図が日本全体に近い広さなので全国' },
    })
  })

  it('駅が 1 つも無ければ全国（手がかりの無いことを言う）', () => {
    expect(locateArea({ kind: 'view', viewport: TAKEBASHI_VIEW }, new Map())).toEqual({
      ok: true,
      area: { ref: 'jp', basisJa: '地図の中心に近い駅が見つからないので全国' },
    })
  })

  it.each([
    ['上限より少し狭い', MAP_WARD_MAX_SPAN_KM - 0.5, 'muni:13101'],
    ['上限より少し広い', MAP_WARD_MAX_SPAN_KM + 0.5, 'pref:13'],
  ])('区の寄り方の境目（縦横の長い方が %s）', (_label, heightKm, ref) => {
    const result = locateArea(
      { kind: 'view', viewport: tallViewAroundTakebashi(heightKm) },
      STATIONS,
    )
    expect(result.ok && result.area.ref).toBe(ref)
  })

  it.each([
    ['ちょうど上限', MAP_VIEW_MAX_LON_SPAN_DEG, 'pref:13'],
    ['上限を超える', MAP_VIEW_MAX_LON_SPAN_DEG + 0.01, 'jp'],
  ])('「このあたり」と言える広さの境目（経度の幅が %s）', (_label, lonSpan, ref) => {
    const viewport: Viewport = {
      west: TAKEBASHI_LON - lonSpan / 2,
      south: TAKEBASHI_LAT - 0.5,
      east: TAKEBASHI_LON + lonSpan / 2,
      north: TAKEBASHI_LAT + 0.5,
    }
    const result = locateArea({ kind: 'view', viewport }, STATIONS)
    expect(result.ok && result.area.ref).toBe(ref)
  })
})

describe('GET /api/areas/locate', () => {
  beforeEach(() => {
    clearAreaCache()
    db.stationCatalog.mockReset()
    db.stationCatalog.mockResolvedValue([...AREA_STATIONS])
  })

  function locate(query: string): Promise<Response> {
    return GET(new Request(`http://localhost/api/areas/locate?${query}`))
  }

  it('選択中の駅 → その市区町村（共通 API の Zod を通り、1 時間キャッシュ）', async () => {
    const response = await locate(`grp=${encodeURIComponent('関内#0')}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe(CACHE.hour)
    expect(areaLocateResponseSchema.parse(await response.json())).toEqual({
      ref: 'muni:14104',
      basisJa: '選択中の駅（関内）の市区町村',
    })
  })

  it('地図の範囲 → 寄り方に合うエリア', async () => {
    const response = await locate('bbox=139.72,35.66,139.8,35.72')
    expect(await response.json()).toEqual({
      ref: 'muni:13101',
      basisJa: '地図の中心に近い駅（竹橋）の市区町村',
    })
  })

  it('駅と範囲の両方なら駅を先に見る（日本全体を見ていても、選んだ駅の市区町村）', async () => {
    const response = await locate(`grp=${encodeURIComponent('新横浜#0')}&bbox=122.9,24,153.9,45.6`)
    expect((await response.json()).ref).toBe('muni:14109')
  })

  it.each([
    ['手がかりが無い', '', 400, 'grp（選択中の駅）か bbox（地図の範囲）が要ります'],
    ['範囲の数が足りない', 'bbox=139.7,35.6,139.8', 400, '範囲は「西,南,東,北」の 4 つの数です'],
    ['範囲が逆さ', 'bbox=139.8,35.6,139.7,35.7', 400, '範囲は「西,南,東,北」の 4 つの数です'],
    ['知らない駅', `grp=${encodeURIComponent('nope#0')}`, 404, '駅が見つかりません: nope#0'],
  ])('%s → %i（理由つき）', async (_label, query, status, message) => {
    const response = await locate(query)
    expect(response.status).toBe(status)
    const body: unknown = await response.json()
    expect(JSON.stringify(body)).toContain(message)
  })

  it('全駅の索引はサーバで持つ（続けて引いても DB は 1 回）', async () => {
    await locate(`grp=${encodeURIComponent('関内#0')}`)
    await locate('bbox=139.72,35.66,139.8,35.72')
    expect(db.stationCatalog).toHaveBeenCalledTimes(1)
  })
})
