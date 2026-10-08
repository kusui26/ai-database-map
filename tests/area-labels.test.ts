/**
 * 場所の言い方と、画面の取得の URL（2026-10-08 B2・`docs/261001_fix_user_feedback_ui.md` §6.4）。
 *
 * - 距離の言い方は 1 か所（`distanceLabel`）：順位表の距離・AI への返却・「竹橋から 5km」の題で同じ
 * - 場所の題は広い順（都道府県 → 市区町村 → 起点から N km → 地図の表示範囲）。どれも無ければ「全国」で、
 *   「全国・竹橋から 5km」とは言わない
 * - 画面の取得（ランキング・散布・おすすめ）は同じ組み立て（`appendFilterParams`）で条件をクエリにする
 * - サーバの中のキャッシュ（`ttlCache`）は期限・失敗・読み込み中の扱いを 1 か所で持つ
 */

import { describe, expect, it, vi } from 'vitest'
import { distanceLabel, MAP_AREA_LABEL_JA, nearLabel } from '@/shared/constants'
import { placeLabel, scopeLabel } from '@/domain/scope'
import {
  appendFilterParams,
  bboxParam,
  type FilterQueryValues,
} from '@/components/metrics/filterQuery'
import { rankingUrl } from '@/components/ranking/useRanking'
import { growthUrl } from '@/components/scatter/useGrowth'
import { ttlCache } from '@/lib/ttl-cache'
import { filterParams } from '@/lib/filter-params'

describe('distanceLabel（距離の言い方）', () => {
  it.each([
    [0, '0m'],
    [850, '850m'],
    [999.4, '999m'],
    // 丸めると 1,000m になる距離は km で言う（「1000m」と言わない）
    [999.6, '1km'],
    [1000, '1km'],
    [1049, '1km'],
    [1050, '1.1km'],
    [4882, '4.9km'],
    [5000, '5km'],
    [12_345, '12.3km'],
    [100_000, '100km'],
  ])('%d m →「%s」', (meters, label) => {
    expect(distanceLabel(meters)).toBe(label)
  })

  it('近傍の言い方は「起点から 半径」（同じ名前の駅は表示名のまま）', () => {
    expect(nearLabel('竹橋', 5000)).toBe('竹橋から 5km')
    expect(nearLabel('大塚（東日本旅客鉄道）', 800)).toBe('大塚（東日本旅客鉄道）から 800m')
  })
})

describe('placeLabel・scopeLabel（題の場所）', () => {
  const near = { label: '竹橋', radiusM: 5000 }
  const bbox = { west: 139.5, south: 35.4, east: 139.8, north: 35.6 }

  it('どれも無ければ「全国」', () => {
    expect(placeLabel({ prefectures: [] })).toBe('全国')
    expect(placeLabel({ prefectures: [], municipality: null, bbox: null, near: null })).toBe('全国')
  })

  it('広い順に並べる（都道府県 → 市区町村 → 起点 → 地図の表示範囲）', () => {
    expect(placeLabel({ prefectures: ['神奈川県'], municipality: '横浜市' })).toBe(
      '神奈川県・横浜市',
    )
    expect(placeLabel({ prefectures: ['東京都'], municipality: '千代田区', near, bbox })).toBe(
      `東京都・千代田区・竹橋から 5km・${MAP_AREA_LABEL_JA}`,
    )
  })

  it('起点だけ・範囲だけなら「全国」を付けない', () => {
    expect(placeLabel({ prefectures: [], near })).toBe('竹橋から 5km')
    expect(placeLabel({ prefectures: [], bbox })).toBe('地図の表示範囲')
  })

  it('空の市区町村は書かない', () => {
    expect(placeLabel({ prefectures: ['東京都'], municipality: '' })).toBe('東京都')
  })

  it('図の題：場所のあとに会社・路線が続く', () => {
    expect(
      scopeLabel({
        prefectures: ['神奈川県'],
        municipality: '横浜市',
        near: null,
        bbox: null,
        operators: ['東京急行電鉄'],
        operatorLabels: ['東急電鉄'],
        routes: [],
        routeTypes: [],
        lines: [{ name: '東急東横線' }],
      }),
    ).toBe('神奈川県・横浜市・東急電鉄・東急東横線')
    expect(scopeLabel({ prefectures: [], near, operators: [], routes: [], routeTypes: [1] })).toBe(
      '竹橋から 5km・新幹線',
    )
  })
})

describe('appendFilterParams（画面の取得の条件）', () => {
  const NONE: FilterQueryValues = {
    prefectures: [],
    municipality: '',
    operators: [],
    routes: [],
    routeTypes: [],
    lines: [],
  }

  function query(values: FilterQueryValues): Record<string, string> {
    const params = new URLSearchParams()
    appendFilterParams(params, values)
    return Object.fromEntries(params)
  }

  it('絞っていない軸は載せない（同じ条件の取得がキャッシュに当たる）', () => {
    expect(query(NONE)).toEqual({})
    expect(query({ ...NONE, bbox: null, near: null })).toEqual({})
  })

  it('すべての軸を API のクエリの名前で載せる', () => {
    expect(
      query({
        prefectures: ['東京都', '神奈川県'],
        municipality: '横浜市',
        operators: ['東京急行電鉄'],
        routes: ['東横線'],
        routeTypes: [1, 2],
        lines: [26001],
        bbox: { west: 139.5, south: 35.4, east: 139.8, north: 35.6 },
        near: { grp: '竹橋#0', radiusM: 5000 },
      }),
    ).toEqual({
      prefecture: '東京都,神奈川県',
      municipality: '横浜市',
      operators: '東京急行電鉄',
      routes: '東横線',
      routeTypes: '1,2',
      lines: '26001',
      bbox: '139.5,35.4,139.8,35.6',
      nearStation: '竹橋#0',
      withinM: '5000',
    })
  })

  it('範囲は「西,南,東,北」', () => {
    expect(bboxParam({ west: 139.5, south: 35.4, east: 139.8, north: 35.6 })).toBe(
      '139.5,35.4,139.8,35.6',
    )
  })

  it('ランキング・散布の取得 URL に場所が入り、サーバの読み方（filterParams）でそのまま読める', () => {
    const values = {
      ...NONE,
      municipality: '横浜市港北区',
      near: { grp: '新横浜#0', radiusM: 3000 },
    }
    const ranking = new URL(
      rankingUrl({ metric: 'pax_2024', ...values, order: 'desc', excludeLowN: true }, 0),
      'http://localhost',
    )
    expect(filterParams(ranking.searchParams)).toMatchObject({
      municipality: '横浜市港北区',
      nearStation: '新横浜#0',
      withinM: '3000',
    })
    const growth = new URL(
      growthUrl({ x: 'pop_gr_2020_2015_1km', y: 'rate_covid', ...values, excludeLowN: false }),
      'http://localhost',
    )
    expect(growth.searchParams.get('municipality')).toBe('横浜市港北区')
    expect(growth.searchParams.get('nearStation')).toBe('新横浜#0')
  })
})

describe('filterParams（サーバがクエリを読む）', () => {
  it('空の値は未指定と同じ（空の prefecture= と同じく絞らない）', () => {
    const params = new URLSearchParams('prefecture=&municipality=&bbox=&nearStation=&withinM=')
    expect(filterParams(params)).toMatchObject({
      prefectures: [],
      municipality: undefined,
      bbox: undefined,
      nearStation: undefined,
      withinM: undefined,
    })
  })
})

describe('ttlCache（サーバの中で一覧をしばらく持つ）', () => {
  const TTL_MS = 1000

  it('期限のあいだは同じ結果。期限ちょうどで読み直す', async () => {
    const load = vi.fn(async () => load.mock.calls.length)
    const cache = ttlCache(load, TTL_MS)
    expect(await cache.get(0)).toBe(1)
    expect(await cache.get(TTL_MS - 1)).toBe(1)
    expect(await cache.get(TTL_MS)).toBe(2)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('読み込み中に呼ばれたら、同じ読み込みを待つ（二重に読まない）', async () => {
    const load = vi.fn(async () => 'ok')
    const cache = ttlCache(load, TTL_MS)
    const [a, b] = await Promise.all([cache.get(0), cache.get(1)])
    expect([a, b]).toEqual(['ok', 'ok'])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('読めなかったときは持たない（元の失敗が届き、次の呼び出しで読み直す）', async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('落ちている'))
      .mockResolvedValue('ok')
    const cache = ttlCache(load, TTL_MS)
    await expect(cache.get(0)).rejects.toThrow('落ちている')
    expect(await cache.get(1)).toBe('ok')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('古い読み込みの失敗が、あとの読み込みを消さない', async () => {
    const failing = Promise.withResolvers<string>()
    const load = vi
      .fn<() => Promise<string>>()
      .mockReturnValueOnce(failing.promise)
      .mockResolvedValue('new')
    const cache = ttlCache(load, TTL_MS)
    const old = cache.get(0)
    // 期限が切れて読み直したあとで、古い読み込みが失敗する
    expect(await cache.get(TTL_MS)).toBe('new')
    failing.reject(new Error('古い'))
    await expect(old).rejects.toThrow('古い')
    expect(await cache.get(TTL_MS + 1)).toBe('new')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('clear で捨てれば読み直す', async () => {
    const load = vi.fn(async () => 'ok')
    const cache = ttlCache(load, TTL_MS)
    await cache.get(0)
    cache.clear()
    await cache.get(1)
    expect(load).toHaveBeenCalledTimes(2)
  })
})
