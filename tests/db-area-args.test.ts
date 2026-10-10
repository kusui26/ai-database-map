/**
 * `src/db/queries.ts`：絞り込み → RPC の引数（2026-10-08 B2）。一覧・ランキング・散布の 3 つの RPC が
 * 同じ組み立て（`filterArgs`）を使い、SQL の絞り込み（`stations_matching_filters`）に同じ名前で渡すことを確かめる。
 *
 * SQL の関数は既存の引数のあとに `muni`・`west`〜`north`・`near_lon`・`near_lat`・`near_radius_m` を足した
 * （既定 null＝以前の呼び出しのまま動く）。名前を 1 文字でも違えると PostgREST は関数を見つけられないので、
 * ここで名前ごと固定する。起点からの距離（`dist_m`）は整数の m で返す。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

const client = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('@/db/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/client')>()
  return { ...actual, db: () => client }
})

const { listStations, rankByColumn, scatterPoints, stationCatalog } = await import('@/db/queries')

const FILTER = {
  prefectures: ['東京都'],
  municipality: '千代田区',
  operators: ['東京地下鉄'],
  routes: ['5号線東西線'],
  routeTypes: [4],
  lines: [28004],
  bbox: { west: 139.5, south: 35.4, east: 139.8, north: 35.8 },
  near: { lon: 139.75852, lat: 35.69028, radiusM: 5000 },
}

/** 述語に渡る絞り込みの引数（3 つの RPC で同じ名前）。 */
const FILTER_ARGS = {
  prefs: ['東京都'],
  muni: '千代田区',
  ops: ['東京地下鉄'],
  route_types: [4],
  line_cds: [28004],
  west: 139.5,
  south: 35.4,
  east: 139.8,
  north: 35.8,
  near_lon: 139.75852,
  near_lat: 35.69028,
  near_radius_m: 5000,
}

/** 何も絞らないときの引数（どれも null＝SQL の既定と同じ）。 */
const NO_FILTER_ARGS = Object.fromEntries(Object.keys(FILTER_ARGS).map((key) => [key, null]))

function lastArgs(): unknown {
  return client.rpc.mock.calls.at(-1)?.[1]
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('絞り込み → RPC の引数', () => {
  it('ランキング：述語の引数と、ページ・法令上の路線（routes）', async () => {
    client.rpc.mockResolvedValue({ data: [], error: null })
    await rankByColumn('pax_2024', FILTER, {
      order: 'desc',
      limit: 50,
      offset: 0,
      excludeLowN: true,
    })
    expect(client.rpc.mock.calls[0]?.[0]).toBe('rank_by_column')
    expect(lastArgs()).toEqual({
      column_key: 'pax_2024',
      dir: 'desc',
      lim: 50,
      off: 0,
      exclude_lown: true,
      routes: ['5号線東西線'],
      ...FILTER_ARGS,
    })
  })

  it('散布：同じ述語の引数', async () => {
    client.rpc.mockResolvedValue({ data: [], error: null })
    await scatterPoints('pop_gr_2020_2015_1km', 'rate_covid', null, null, FILTER)
    expect(client.rpc.mock.calls[0]?.[0]).toBe('scatter_points')
    expect(lastArgs()).toEqual({
      x_key: 'pop_gr_2020_2015_1km',
      y_key: 'rate_covid',
      x_flag_key: null,
      y_flag_key: null,
      routes: ['5号線東西線'],
      ...FILTER_ARGS,
    })
  })

  it('一覧：同じ述語の引数（法令上の路線は routes_in・明示の駅と件数）', async () => {
    client.rpc.mockResolvedValue({ data: [], error: null })
    await listStations({ ...FILTER, grps: ['竹橋#0'], limit: 10 })
    expect(client.rpc.mock.calls[0]?.[0]).toBe('list_stations')
    expect(lastArgs()).toEqual({
      routes_in: ['5号線東西線'],
      grps: ['竹橋#0'],
      lim: 10,
      ...FILTER_ARGS,
    })
  })

  it('何も絞らなければ、述語の引数はどれも null（空の配列・空の範囲も渡さない）', async () => {
    client.rpc.mockResolvedValue({ data: [], error: null })
    await scatterPoints('pop_gr_2020_2015_1km', 'rate_covid', null, null, {
      prefectures: [],
      operators: [],
      routeTypes: [],
      lines: [],
    })
    expect(lastArgs()).toMatchObject({ ...NO_FILTER_ARGS, routes: null })
  })
})

describe('起点からの距離（dist_m）', () => {
  it('ランキング・一覧は整数の m で返す。近傍でなければ載せない', async () => {
    client.rpc.mockResolvedValueOnce({
      data: [
        rankRow('新宿三丁目#0', 4881.62),
        { ...rankRow('竹橋#0', null), rank: 2 },
        { ...rankRow('九段下#0', undefined), rank: 3 },
      ],
      error: null,
    })
    const { rows } = await rankByColumn('pax_2024', FILTER, {
      order: 'desc',
      limit: 50,
      offset: 0,
      excludeLowN: false,
    })
    expect(rows.map((row) => row.distM)).toEqual([4882, undefined, undefined])
    expect(rows[1]).not.toHaveProperty('distM')

    client.rpc.mockResolvedValueOnce({ data: [listRow(849.5)], error: null })
    const [item] = await listStations(FILTER)
    expect(item?.distM).toBe(850)
  })
})

describe('全駅の索引（station_catalog）', () => {
  it('jsonb 1 つ（1,000 行の上限を超えて全駅）を読み、名前を揃える', async () => {
    client.rpc.mockResolvedValueOnce({
      data: [
        {
          grp: '竹橋#0',
          name: '竹橋',
          label: '竹橋',
          prefecture: '東京都',
          municipality: '千代田区',
          municipality_code: '13101',
          lon: 139.75852,
          lat: 35.69028,
          pax: 42156,
        },
      ],
      error: null,
    })
    expect(await stationCatalog()).toEqual([
      {
        grp: '竹橋#0',
        name: '竹橋',
        label: '竹橋',
        prefecture: '東京都',
        municipality: '千代田区',
        municipalityCode: '13101',
        lon: 139.75852,
        lat: 35.69028,
        paxLatest: 42156,
      },
    ])
    expect(client.rpc).toHaveBeenCalledWith('station_catalog', {})
  })

  it('形が違えば受け取らない（索引を壊れたまま持たない）', async () => {
    client.rpc.mockResolvedValueOnce({ data: [{ grp: '竹橋#0' }], error: null })
    await expect(stationCatalog()).rejects.toThrow()
  })
})

function rankRow(grp: string, distM: number | null | undefined): Record<string, unknown> {
  return {
    grp,
    station_name: grp.replace(/#\d+$/u, ''),
    prefecture: '東京都',
    value: 1,
    flag_value: 0,
    rank: 1,
    total: 3,
    ...(distM === undefined ? {} : { dist_m: distM }),
  }
}

function listRow(distM: number): Record<string, unknown> {
  return {
    grp: '九段下#0',
    station_name: '九段下',
    label: '九段下',
    prefecture: '東京都',
    municipality: '千代田区',
    municipality_code: '13101',
    lon: 139.75,
    lat: 35.695,
    n_op: 2,
    pax_latest: 100_000,
    dist_m: distM,
  }
}
