/**
 * `src/db/queries.ts` のエリアの問い合わせ（2026-10-10 B5b）：RPC の名前と引数、行の写し方。
 *
 * SQL の関数（`supabase/migrations/20261010210000_area_summary.sql`）は引数を名前で受ける（PostgREST）。1 文字でも違えると
 * 関数が見つからないので、ここで名前ごと固定する。値そのもの（駅の数・分位・公表値）は `pipeline/golden_area_summary_test.py`
 * が本物の DB で確かめる。
 *
 * 見ること：
 * - 区域の行：鍵と内訳の子の有無を渡し、snake_case → camelCase・値は Map。鍵が無ければ問い合わせない
 * - 駅の分布：絞り込みは一覧・ランキングと同じ引数（`filterArgs`＋`routes`）。分位の double の端数（2.3499999999999996）は
 *   有効 12 桁で落とす（2.35）
 * - 色分けの値：値の無い駅は null・⚠ は 1 のときだけ
 * - 路線の駅：`line_stations` を路線コードで絞り、路線の順に並べて駅を結ぶ
 * - DB の失敗は DbError（ルートが 502 にする）
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { DbError } from '@/db/client'

const client = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))

vi.mock('@/db/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/client')>()
  return { ...actual, db: () => client }
})

const { areaCatalogRows, areaRows, areaStationStats, lineStationsInOrder, stationMetricValues } =
  await import('@/db/queries')

/** 何も絞らないときの述語の引数（どれも null）。 */
const NO_FILTER_ARGS = {
  prefs: null,
  muni: null,
  ops: null,
  route_types: null,
  line_cds: null,
  west: null,
  south: null,
  east: null,
  north: null,
  near_lon: null,
  near_lat: null,
  near_radius_m: null,
}

const RAW_ROW = {
  key: 'muni:14100',
  code: '14100',
  kind: 'city',
  name: '横浜市',
  label: '神奈川県横浜市',
  values: { pop_2020: 3777491, pop_2025: 3750952 },
  line_cd: null,
  missing: [],
  width_m: null,
  area_km2: 438.23,
  group_key: null,
  parent_key: 'pref:14',
  prefecture: '神奈川県',
  station_count: 137,
}

function lastCall(): readonly unknown[] {
  return client.rpc.mock.calls.at(-1) ?? []
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('区域の行（area_rows）', () => {
  it('鍵と内訳の子の有無を渡し、camelCase と Map に写す', async () => {
    client.rpc.mockResolvedValue({ data: [RAW_ROW], error: null })
    const rows = await areaRows(['muni:14100'], true)
    expect(lastCall()).toEqual(['area_rows', { keys: ['muni:14100'], with_children: true }])
    expect(rows[0]).toMatchObject({
      key: 'muni:14100',
      kind: 'city',
      nameJa: '横浜市',
      labelJa: '神奈川県横浜市',
      parentKey: 'pref:14',
      groupKey: null,
      lineCd: null,
      widthM: null,
      areaKm2: 438.23,
      stationCount: 137,
    })
    expect(rows[0]?.values.get('pop_2025')).toBe(3750952)
  })

  it('鍵が無ければ問い合わせない（駅から N m・範囲だけのとき）', async () => {
    expect(await areaRows([], true)).toEqual([])
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it('知らない種類の行は Zod で落とす（DB の形のずれを黙って通さない）', async () => {
    client.rpc.mockResolvedValue({ data: [{ ...RAW_ROW, kind: 'village' }], error: null })
    await expect(areaRows(['muni:14100'], false)).rejects.toThrow()
  })

  it('DB の失敗は DbError', async () => {
    client.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(areaRows(['muni:14100'], false)).rejects.toBeInstanceOf(DbError)
  })
})

describe('行政区域の一覧（area_catalog）', () => {
  it('引数なしで呼び、値と沿線の列を持たない行に写す', async () => {
    const {
      values: _values,
      line_cd: _lineCd,
      width_m: _widthM,
      area_km2: _areaKm2,
      ...catalogRow
    } = RAW_ROW
    client.rpc.mockResolvedValue({ data: [catalogRow], error: null })
    const rows = await areaCatalogRows()
    expect(lastCall()).toEqual(['area_catalog', {}])
    expect(rows).toEqual([
      {
        key: 'muni:14100',
        kind: 'city',
        code: '14100',
        nameJa: '横浜市',
        labelJa: '神奈川県横浜市',
        prefecture: '神奈川県',
        parentKey: 'pref:14',
        groupKey: null,
        missing: [],
        stationCount: 137,
      },
    ])
  })
})

describe('駅の分布（area_station_stats）', () => {
  const raw = {
    station_count: 137,
    stats: [
      {
        key: 'pop_gr_pred_2024_2050_1km',
        n: 136,
        flagged_n: 0,
        q1: -10.7,
        median: -3.8,
        q3: 2.3499999999999996,
        top: [{ grp: '新綱島#0', label: '新綱島', value: 10.4 }],
        bottom: [{ grp: '並木中央#0', label: '並木中央', value: -35.3 }],
      },
      {
        key: 'lp_med_2026_1km',
        n: 0,
        flagged_n: 3,
        q1: null,
        median: null,
        q3: null,
        top: [],
        bottom: [],
      },
    ],
  }

  it('絞り込みは一覧・ランキングと同じ引数（市区町村は前方一致の名前）', async () => {
    client.rpc.mockResolvedValue({ data: raw, error: null })
    await areaStationStats(['pop_2020_1km'], { municipality: '横浜市' })
    expect(lastCall()).toEqual([
      'area_station_stats',
      { keys: ['pop_2020_1km'], ...NO_FILTER_ARGS, muni: '横浜市', routes: null },
    ])
  })

  it('沿線は路線コード・駅から N m は起点と半径', async () => {
    client.rpc.mockResolvedValue({ data: raw, error: null })
    await areaStationStats(['pop_2020_1km'], { lines: [26001] })
    expect(lastCall()[1]).toMatchObject({ line_cds: [26001] })
    await areaStationStats(['pop_2020_1km'], {
      near: { lon: 139.75852, lat: 35.69028, radiusM: 5000 },
    })
    expect(lastCall()[1]).toMatchObject({
      near_lon: 139.75852,
      near_lat: 35.69028,
      near_radius_m: 5000,
    })
  })

  it('分位の double の端数を落とす（2.3499999999999996 → 2.35）・値の無い分位は null のまま', async () => {
    client.rpc.mockResolvedValue({ data: raw, error: null })
    const { stationCount, stats } = await areaStationStats(['x'], {})
    expect(stationCount).toBe(137)
    expect(stats[0]).toMatchObject({
      key: 'pop_gr_pred_2024_2050_1km',
      n: 136,
      flaggedN: 0,
      q1: -10.7,
      median: -3.8,
      q3: 2.35,
    })
    expect(stats[1]).toMatchObject({ n: 0, flaggedN: 3, q1: null, median: null, q3: null })
  })
})

describe('色分けの値（station_metric_values）', () => {
  it('指標の key と絞り込みを渡し、値の無い駅は null・⚠ は 1 のときだけ', async () => {
    client.rpc.mockResolvedValue({
      data: {
        station_count: 3,
        values: [
          ['みなとみらい#0', 24.3, 0],
          ['海芝浦#0', null, 0],
          ['新芝浦#0', -20, 1],
        ],
      },
      error: null,
    })
    const result = await stationMetricValues('pop_gr_2020_2015_1km', { municipality: '横浜市' })
    expect(lastCall()).toEqual([
      'station_metric_values',
      { column_key: 'pop_gr_2020_2015_1km', ...NO_FILTER_ARGS, muni: '横浜市', routes: null },
    ])
    expect(result).toEqual({
      stationCount: 3,
      values: [
        { grp: 'みなとみらい#0', value: 24.3, flagged: false },
        { grp: '海芝浦#0', value: null, flagged: false },
        { grp: '新芝浦#0', value: -20, flagged: true },
      ],
    })
  })
})

describe('路線の駅（line_stations）', () => {
  it('路線コードで絞り、路線の順に並べ、駅の grp と表示名を結ぶ', async () => {
    const calls: unknown[][] = []
    const chain = {
      select: (...args: unknown[]) => {
        calls.push(['select', ...args])
        return chain
      },
      eq: (...args: unknown[]) => {
        calls.push(['eq', ...args])
        return chain
      },
      order: async (...args: unknown[]) => {
        calls.push(['order', ...args])
        return {
          data: [
            { seq: 1, stations: { grp: '渋谷#0', label: '渋谷' } },
            { seq: 2, stations: { grp: '代官山#0', label: '代官山' } },
          ],
          error: null,
        }
      },
    }
    client.from.mockReturnValue(chain)
    const stations = await lineStationsInOrder(26001)
    expect(client.from).toHaveBeenCalledWith('line_stations')
    expect(calls).toEqual([
      ['select', 'seq,stations(grp,label)'],
      ['eq', 'line_cd', 26001],
      ['order', 'seq'],
    ])
    expect(stations).toEqual([
      { seq: 1, grp: '渋谷#0', label: '渋谷' },
      { seq: 2, grp: '代官山#0', label: '代官山' },
    ])
  })
})
