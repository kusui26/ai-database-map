/**
 * ツール（ランキング・散布・駅の一覧・データセット）が市区町村・起点の駅・範囲を受け、サーバで名前を決めて
 * 共通の条件で絞ることを、DB を差し替えて確かめる（2026-10-08 B2・`docs/261001_fix_user_feedback_ui.md` §6.4）。
 *
 * 以前はランキング・散布に市区町村も範囲も無く、「横浜市で」を神奈川県で代用し、「竹橋から 5km 範囲で」を
 * 各駅の集計半径（radiusM）に入れて全国の順位で答えていた（§6.1）。ここで固定するのは：
 *
 * - 市区町村・起点の駅は名前で受け、決めた値が SQL の条件に入る。返却に場所の言い方（`place`）と読み替え（`nameNotes`）
 * - 起点から N m（near）と集計半径（radiusM）は別物——同時に指定しても混ざらない
 * - 返却の各駅に起点からの距離（`distance`）をサーバが付ける（AI に距離を作らせない）
 * - 決められなければ図を作らず、DB にも行かずに候補を返す
 * - エリアを先に決める——決めた市区町村の都道府県が、同じ名前の路線を決める手がかりになる
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type RankRow, type ScatterRow, type StationFilter } from '@/db/queries'
import { type StationListItem } from '@/shared/api'
import { datasetSecret, verifyDatasetToken } from '@/ai/dataset/token'
import { AREA_STATIONS, OSAKA_VIEW, TOKYO_VIEW } from './fixtures/area-catalog'
import { LEGAL_ROUTES, OPERATORS, lineRows } from './fixtures/line-catalog'

const db = vi.hoisted(() => ({
  rankByColumn: vi.fn(),
  scatterPoints: vi.fn(),
  listStations: vi.fn(),
  datasetRows: vi.fn(),
  lineNames: vi.fn(),
  operatorNames: vi.fn(),
  routeNames: vi.fn(),
  stationCatalog: vi.fn(),
}))

vi.mock('@/db/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/queries')>()
  return { ...actual, ...db }
})

const { TOOL_SPECS } = await import('@/ai/tool-specs')
const { clearAreaCache } = await import('@/ai/area/catalog')
const { clearRouteNameCache } = await import('@/ai/routes/catalog')
const { clearOperatorLabelCache } = await import('@/domain/operators')
const { rankingPanel } = await import('@/domain/ranking/panel')
const { scatterPanel } = await import('@/domain/growth/panel')

const CTX = { origin: 'http://localhost:3000' }

/** 竹橋の座標（本物の `station_catalog()`）。 */
const TAKEBASHI = { lon: 139.75852, lat: 35.69028 }

const RANK_ROWS: RankRow[] = [
  {
    grp: '新宿三丁目#0',
    stationName: '新宿三丁目',
    prefecture: '東京都',
    value: 30_000_000,
    flagValue: 0,
    rank: 1,
    distM: 4882,
  },
  {
    grp: '竹橋#0',
    stationName: '竹橋',
    prefecture: '東京都',
    value: 10_000_000,
    flagValue: 0,
    rank: 2,
    distM: 0,
  },
]
const SCATTER_ROWS: ScatterRow[] = [
  { grp: '新横浜#0', stationName: '新横浜', x: 5, y: -3, xFlag: 0, yFlag: 0 },
  { grp: '日吉#1', stationName: '日吉', x: 8, y: -6, xFlag: 0, yFlag: 0 },
]
const LISTED: StationListItem = {
  grp: '九段下#0',
  stationName: '九段下',
  label: '九段下',
  prefecture: '東京都',
  municipality: '千代田区',
  municipalityCode: '13101',
  lon: 139.75,
  lat: 35.695,
  nOp: 2,
  paxLatest: 100_000,
  distM: 850,
}

/** ランキングが SQL に渡した絞り込み。 */
function rankFilter(): StationFilter {
  const filter: unknown = db.rankByColumn.mock.calls[0]?.[1]
  if (typeof filter !== 'object' || filter === null) throw new Error('ランキングを呼んでいない')
  return filter
}

/** 一覧が SQL に渡した絞り込み（最後の呼び出し）。 */
function listFilter(): StationFilter {
  const filter: unknown = db.listStations.mock.calls.at(-1)?.[0]
  if (typeof filter !== 'object' || filter === null) throw new Error('一覧を呼んでいない')
  return filter
}

beforeEach(() => {
  clearAreaCache()
  clearRouteNameCache()
  clearOperatorLabelCache()
  db.stationCatalog.mockResolvedValue([...AREA_STATIONS])
  db.lineNames.mockResolvedValue(lineRows())
  db.operatorNames.mockResolvedValue(OPERATORS)
  db.routeNames.mockResolvedValue(
    LEGAL_ROUTES.map((row) => ({ ...row, stationCount: 1, routeTypes: [4] })),
  )
  db.rankByColumn.mockResolvedValue({ rows: RANK_ROWS, total: RANK_ROWS.length })
  db.scatterPoints.mockResolvedValue(SCATTER_ROWS)
  db.listStations.mockResolvedValue([LISTED])
  db.datasetRows.mockResolvedValue({})
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('rankStations：市区町村', () => {
  it('「横浜」→ 横浜市（神奈川県を添える）。返却に場所と読み替え・題は「神奈川県・横浜市」', async () => {
    const result = await TOOL_SPECS.rankStations.run(
      { metric: 'lp_near_price', municipality: '横浜' },
      CTX,
    )
    expect(rankFilter()).toMatchObject({ prefectures: ['神奈川県'], municipality: '横浜市' })
    expect(result.forLlm).toMatchObject({
      place: '神奈川県・横浜市',
      prefectures: ['神奈川県'],
      nameNotes: [
        '市区町村「横浜」は 横浜市（神奈川県） として扱いました（ほかに 横浜町（青森県） があります）。',
      ],
    })
    const [effect] = result.effects
    if (effect?.kind !== 'ranking') throw new Error('順位表が無い')
    expect(effect.response).toMatchObject({ municipality: '横浜市', near: null, bbox: null })
    expect(rankingPanel(effect.response).title).toBe(
      '最寄地価公示価格（2026年）（神奈川県・横浜市・上位）',
    )
  })

  it('大阪の地図の「港区」は大阪市港区（地図の範囲で決めたことを書く）', async () => {
    const result = await TOOL_SPECS.rankStations.run(
      { metric: 'lp_near_price', municipality: '港区' },
      { ...CTX, viewport: OSAKA_VIEW },
    )
    expect(rankFilter()).toMatchObject({ prefectures: ['大阪府'], municipality: '大阪市港区' })
    expect(JSON.stringify(result.forLlm)).toContain('地図の表示範囲にある 大阪市港区（大阪府）')
  })

  it('決まらない「中区」は図を作らず、集計も走らせずに候補を返す', async () => {
    const result = await TOOL_SPECS.rankStations.run(
      { metric: 'lp_near_price', municipality: '中区' },
      CTX,
    )
    expect(result.effects).toEqual([])
    expect(db.rankByColumn).not.toHaveBeenCalled()
    expect(result.forLlm).toMatchObject({
      error: '場所（市区町村・起点の駅・範囲）を決められませんでした',
      problems: [
        {
          input: '中区',
          candidates: [
            { municipality: '横浜市中区', prefecture: '神奈川県', stationCount: 2 },
            { municipality: '名古屋市中区', prefecture: '愛知県', stationCount: 1 },
            { municipality: '広島市中区', prefecture: '広島県', stationCount: 1 },
          ],
        },
      ],
    })
  })

  it('エリアを先に決める：決めた市区町村の都道府県で、同じ名前の路線が決まる（大阪市 × 中央線）', async () => {
    const result = await TOOL_SPECS.rankStations.run(
      { metric: 'lp_near_price', municipality: '大阪市', routes: ['中央線'] },
      { ...CTX, viewport: TOKYO_VIEW },
    )
    expect(rankFilter()).toMatchObject({
      prefectures: ['大阪府'],
      municipality: '大阪市',
      lines: [99621],
    })
    expect(result.effects).toHaveLength(1)
  })
})

describe('rankStations：起点の駅から N m 以内（「竹橋から 5km 範囲」）', () => {
  it('起点の座標と半径が SQL に入り、各駅に距離が付く。題は「竹橋から 5km」', async () => {
    const result = await TOOL_SPECS.rankStations.run(
      { metric: 'lp_near_price', near: { station: '竹橋', withinM: 5000 } },
      CTX,
    )
    expect(rankFilter().near).toEqual({ ...TAKEBASHI, radiusM: 5000 })
    // 起点の都道府県は添えない（半径は都道府県の境をまたぐ）
    expect(rankFilter().prefectures).toEqual([])
    expect(result.forLlm).toMatchObject({
      place: '竹橋から 5km',
      rows: [
        { rank: 1, name: '新宿三丁目', distance: '4.9km' },
        { rank: 2, name: '竹橋', distance: '0m' },
      ],
    })
    const [effect] = result.effects
    if (effect?.kind !== 'ranking') throw new Error('順位表が無い')
    expect(effect.response.near).toEqual({ grp: '竹橋#0', label: '竹橋', radiusM: 5000 })
    expect(effect.response.rows.map((row) => row.distM)).toEqual([4882, 0])
    expect(rankingPanel(effect.response).title).toBe(
      '最寄地価公示価格（2026年）（竹橋から 5km・上位）',
    )
  })

  it('集計半径（radiusM）と起点からの範囲（near.withinM）は混ざらない', async () => {
    const result = await TOOL_SPECS.rankStations.run(
      { metric: 'pop_gr', radiusM: 2000, near: { station: '竹橋', withinM: 5000 } },
      CTX,
    )
    expect(db.rankByColumn.mock.calls[0]?.[0]).toBe('pop_gr_2020_2015_2km')
    expect(rankFilter().near?.radiusM).toBe(5000)
    expect(result.forLlm).toMatchObject({ resolvedMetric: 'pop_gr_2020_2015_2km' })
  })

  it('起点が決まらない（府中は 4 か所）・半径が無いときは、図を作らずに直し方を返す', async () => {
    const ambiguous = await TOOL_SPECS.rankStations.run(
      { metric: 'lp_near_price', near: { station: '府中', withinM: 3000 } },
      CTX,
    )
    expect(ambiguous.effects).toEqual([])
    expect(JSON.stringify(ambiguous.forLlm)).toContain('府中#0')
    expect(db.rankByColumn).not.toHaveBeenCalled()
  })

  it('範囲の外の半径は丸めて、そう書く', async () => {
    const result = await TOOL_SPECS.rankStations.run(
      { metric: 'lp_near_price', near: { station: '竹橋', withinM: 300_000 } },
      CTX,
    )
    expect(rankFilter().near?.radiusM).toBe(100_000)
    expect(result.forLlm).toMatchObject({
      place: '竹橋から 100km',
      nameNotes: ['半径は 100m〜100km なので、100km にしました。'],
    })
  })

  it('0 件なら図を作らず、条件に場所の言い方を載せる', async () => {
    db.rankByColumn.mockResolvedValue({ rows: [], total: 0 })
    const result = await TOOL_SPECS.rankStations.run(
      { metric: 'lp_near_price', near: { station: '竹橋', withinM: 200 } },
      CTX,
    )
    expect(result.effects).toEqual([])
    expect(result.forLlm).toMatchObject({
      total: 0,
      conditions: { place: '竹橋から 200m' },
    })
  })
})

describe('rankStations：範囲（bbox）', () => {
  it('範囲が SQL に入り、題は「地図の表示範囲」。逆さの範囲は集計せずに直し方を返す', async () => {
    const result = await TOOL_SPECS.rankStations.run(
      { metric: 'lp_near_price', bbox: [139.5, 35.4, 139.8, 35.6] },
      CTX,
    )
    expect(rankFilter().bbox).toEqual({ west: 139.5, south: 35.4, east: 139.8, north: 35.6 })
    expect(result.forLlm).toMatchObject({ place: '地図の表示範囲' })
    vi.clearAllMocks()
    const reversed = await TOOL_SPECS.rankStations.run(
      { metric: 'lp_near_price', bbox: [139.8, 35.4, 139.5, 35.6] },
      CTX,
    )
    expect(reversed.effects).toEqual([])
    expect(db.rankByColumn).not.toHaveBeenCalled()
    expect(reversed.forLlm).toMatchObject({ problems: [{ input: 'bbox' }] })
  })
})

describe('compareGrowth：ランキングと同じ場所の条件', () => {
  it('市区町村と起点が散布の条件に入り、返却・応答・題に場所が入る', async () => {
    const result = await TOOL_SPECS.compareGrowth.run(
      {
        x: 'pop_gr',
        y: 'rate_covid',
        municipality: '港北区',
        near: { station: '新横浜', withinM: 3000 },
      },
      CTX,
    )
    expect(db.scatterPoints.mock.calls[0]?.[4]).toMatchObject({
      prefectures: ['神奈川県'],
      municipality: '横浜市港北区',
      near: { lon: 139.617085176, lat: 35.507935764, radiusM: 3000 },
    })
    expect(result.forLlm).toMatchObject({ place: '神奈川県・横浜市港北区・新横浜から 3km' })
    const [effect] = result.effects
    if (effect?.kind !== 'growth') throw new Error('散布が無い')
    expect(effect.response).toMatchObject({
      municipality: '横浜市港北区',
      near: { grp: '新横浜#0', label: '新横浜', radiusM: 3000 },
    })
    expect(scatterPanel(effect.response).title).toContain(
      '（神奈川県・横浜市港北区・新横浜から 3km）',
    )
  })

  it('決まらない言い方は、散布の集計を走らせない', async () => {
    const result = await TOOL_SPECS.compareGrowth.run(
      { x: 'pop_gr', y: 'rate_covid', near: { station: '日本橋', withinM: 3000 } },
      CTX,
    )
    expect(result.effects).toEqual([])
    expect(db.scatterPoints).not.toHaveBeenCalled()
  })
})

describe('listStations：起点・市区町村（セレクタ）', () => {
  it('起点の駅から N m 以内。各駅に距離が付く', async () => {
    const result = await TOOL_SPECS.listStations.run(
      { near: { station: '竹橋', withinM: 3000 } },
      CTX,
    )
    expect(listFilter().near).toEqual({ ...TAKEBASHI, radiusM: 3000 })
    expect(result.forLlm).toMatchObject({ stations: [{ grp: '九段下#0', distance: '850m' }] })
  })

  it('駅でない地点（lon・lat）と、以前の名前 radiusM も受ける（互換）', async () => {
    await TOOL_SPECS.listStations.run({ near: { lon: 139.7, lat: 35.68, radiusM: 2000 } }, CTX)
    expect(listFilter().near).toEqual({ lon: 139.7, lat: 35.68, radiusM: 2000 })
    expect(db.stationCatalog).not.toHaveBeenCalled()
  })

  it('経度と緯度を取り違えた地点は、一覧を引かずに直し方を返す', async () => {
    const result = await TOOL_SPECS.listStations.run(
      { near: { lon: 35.68, lat: 139.7, withinM: 2000 } },
      CTX,
    )
    expect(db.listStations).not.toHaveBeenCalled()
    expect(result.forLlm).toMatchObject({ problems: [{ input: 'near' }] })
  })

  it('「港北区」→ 横浜市港北区（神奈川県を添える・読み替えを書く）', async () => {
    const result = await TOOL_SPECS.listStations.run({ municipality: '港北区' }, CTX)
    expect(listFilter()).toMatchObject({
      prefectures: ['神奈川県'],
      municipality: '横浜市港北区',
    })
    expect(result.forLlm).toMatchObject({
      nameNotes: ['市区町村「港北区」は 横浜市港北区（神奈川県） として扱いました。'],
    })
  })

  it('決まらない言い方は一覧を引かずに候補を返す', async () => {
    const result = await TOOL_SPECS.listStations.run({ municipality: '府中' }, CTX)
    expect(db.listStations).not.toHaveBeenCalled()
    expect(result.forLlm).toMatchObject({ problems: [{ input: '府中' }] })
  })
})

describe('buildDataset：署名つきの条件に、決めた場所が入る（CSV を作り直しても同じ駅）', () => {
  it('起点は座標と半径、市区町村は決めた値で署名される', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await TOOL_SPECS.buildDataset.run(
      {
        stations: { municipality: '千代田', near: { station: '竹橋', withinM: 2000 } },
        metrics: ['pop_2020_1km'],
      },
      CTX,
    )
    const token = JSON.stringify(result.forLlm).match(/t=([^&"]+)/u)?.[1]
    expect(token).toBeDefined()
    const verified = verifyDatasetToken(token ?? '', { secret: datasetSecret(), now: Date.now() })
    expect(verified.ok && verified.query.selector).toMatchObject({
      prefectures: ['東京都'],
      municipality: '千代田区',
      near: { ...TAKEBASHI, radiusM: 2000 },
    })
  })
})

describe('全駅の索引のキャッシュ', () => {
  it('名前が無い呼び出しは索引を読まない。続けて呼んでも 1 回だけ読む', async () => {
    await TOOL_SPECS.rankStations.run({ metric: 'lp_near_price' }, CTX)
    expect(db.stationCatalog).not.toHaveBeenCalled()
    await TOOL_SPECS.rankStations.run({ metric: 'lp_near_price', municipality: '横浜市' }, CTX)
    await TOOL_SPECS.rankStations.run(
      { metric: 'lp_near_price', near: { station: '竹橋', withinM: 1000 } },
      CTX,
    )
    expect(db.stationCatalog).toHaveBeenCalledTimes(1)
  })

  it('読めなかったときは持たない（次の呼び出しで読み直す）', async () => {
    db.stationCatalog.mockRejectedValueOnce(new Error('DB が落ちている'))
    await expect(
      TOOL_SPECS.rankStations.run({ metric: 'lp_near_price', municipality: '横浜市' }, CTX),
    ).rejects.toThrow('DB が落ちている')
    await TOOL_SPECS.rankStations.run({ metric: 'lp_near_price', municipality: '横浜市' }, CTX)
    expect(db.stationCatalog).toHaveBeenCalledTimes(2)
    expect(rankFilter().municipality).toBe('横浜市')
  })
})
