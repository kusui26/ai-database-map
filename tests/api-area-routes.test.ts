/**
 * 共通 API の場所の条件——ランキング・散布・駅の一覧の `municipality`・`bbox`・`nearStation`＋`withinM`
 * （2026-10-08 B2・`docs/261001_fix_user_feedback_ui.md` §6.4）を、DB を差し替えて本物のルートで確かめる。
 *
 * 見ること：
 * - 条件が SQL の引数まで届く（起点は grp で受け、座標はサーバが引く）
 * - 応答に場所が返り（`municipality`・`bbox`・`near`）、題に場所の言い方が入る（「神奈川県・横浜市」「竹橋から 5km」）
 * - 近傍のときは各行に起点からの距離（`distM`）が付く
 * - 形の崩れた範囲・組になっていない起点と半径・知らない起点・範囲の外の半径は 400 で、**集計を走らせない**
 *   （黙って捨てると、利用者が指定したのとは別の駅の集合＝全国で答えてしまう）
 * - 空の値（`municipality=`）は指定しないのと同じ（空の `prefecture=` と同じ扱い）
 *
 * SQL そのもの（述語・距離・RPC）は `pipeline/golden_area_test.py` が本物の DB で確かめる。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type RankRow, type ScatterRow, type StationFilter } from '@/db/queries'
import {
  growthResponseSchema,
  rankingResponseSchema,
  stationListItemSchema,
  type StationListItem,
  type StationRow,
} from '@/shared/api'
import { rankingPanel } from '@/domain/ranking/panel'
import { scatterPanel } from '@/domain/growth/panel'

const db = vi.hoisted(() => ({
  rankByColumn: vi.fn(),
  scatterPoints: vi.fn(),
  listStations: vi.fn(),
  stationByGrp: vi.fn(),
}))

vi.mock('@/db/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/queries')>()
  return { ...actual, ...db }
})

const { GET: getRanking } = await import('@/app/api/ranking/route')
const { GET: getGrowth } = await import('@/app/api/growth/route')
const { GET: getStations } = await import('@/app/api/stations/route')

const TAKEBASHI: StationRow = {
  grp: '竹橋#0',
  stationName: '竹橋',
  label: '竹橋',
  searchLabel: '竹橋（東京都）',
  prefecture: '東京都',
  municipality: '千代田区',
  lon: 139.75852,
  lat: 35.69028,
  nOp: 1,
  operators: '東京地下鉄',
  paxLatest: 42156,
  lpNearUse: null,
  levelComplete: true,
}

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
  { grp: '渋谷#0', stationName: '渋谷', x: 5, y: -3, xFlag: 0, yFlag: 0 },
  { grp: '池袋#0', stationName: '池袋', x: 8, y: -6, xFlag: 0, yFlag: 0 },
]
const LISTED: StationListItem = {
  grp: '新横浜#0',
  stationName: '新横浜',
  label: '新横浜',
  prefecture: '神奈川県',
  municipality: '横浜市港北区',
  municipalityCode: '14109',
  lon: 139.617,
  lat: 35.508,
  nOp: 3,
  paxLatest: 362683,
  distM: 1234,
}

function request(path: string): Request {
  return new Request(`http://localhost${path}`, { headers: { 'x-real-ip': '10.0.0.10' } })
}

/** ランキングが SQL に渡した絞り込み（1 回目の呼び出し）。 */
function rankFilter(): StationFilter {
  const filter: unknown = db.rankByColumn.mock.calls[0]?.[1]
  if (typeof filter !== 'object' || filter === null) throw new Error('ランキングを呼んでいない')
  return filter
}

async function errorOf(response: Response): Promise<{ status: number; message: string }> {
  const parsed: unknown = await response.json()
  const message =
    typeof parsed === 'object' && parsed !== null && 'error' in parsed
      ? JSON.stringify(parsed.error)
      : JSON.stringify(parsed)
  return { status: response.status, message }
}

beforeEach(() => {
  db.rankByColumn.mockResolvedValue({ rows: RANK_ROWS, total: RANK_ROWS.length })
  db.scatterPoints.mockResolvedValue(SCATTER_ROWS)
  db.listStations.mockResolvedValue([LISTED])
  db.stationByGrp.mockImplementation(async (grp: string) => (grp === '竹橋#0' ? TAKEBASHI : null))
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/ranking：市区町村', () => {
  it('前方一致の値が SQL に届き、応答と題に場所が入る（「神奈川県・横浜市」）', async () => {
    const response = await getRanking(
      request(
        `/api/ranking?metric=lp_near_price&prefecture=${encodeURIComponent('神奈川県')}&municipality=${encodeURIComponent('横浜市')}`,
      ),
    )
    expect(response.status).toBe(200)
    expect(rankFilter()).toMatchObject({ prefectures: ['神奈川県'], municipality: '横浜市' })
    expect(rankFilter()).not.toHaveProperty('near')
    const ranking = rankingResponseSchema.parse(await response.json())
    expect(ranking).toMatchObject({ municipality: '横浜市', bbox: null, near: null })
    expect(rankingPanel(ranking).title).toBe('最寄地価公示価格（2026年）（神奈川県・横浜市・上位）')
    // 起点で絞っていなければ、SQL も距離を返さない（ここでは差し替えた行のまま）
    expect(stationByGrpCalls()).toBe(0)
  })

  it('前後の空白は除く。空の値は指定しないのと同じ', async () => {
    await getRanking(
      request(`/api/ranking?metric=lp_near_price&municipality=${encodeURIComponent(' 横浜市 ')}`),
    )
    expect(rankFilter().municipality).toBe('横浜市')
    vi.clearAllMocks()
    db.rankByColumn.mockResolvedValue({ rows: RANK_ROWS, total: RANK_ROWS.length })
    const response = await getRanking(
      request('/api/ranking?metric=lp_near_price&municipality=&bbox=&nearStation=&withinM='),
    )
    expect(response.status).toBe(200)
    expect(rankFilter()).not.toHaveProperty('municipality')
    expect(rankFilter()).not.toHaveProperty('bbox')
    expect(rankFilter()).not.toHaveProperty('near')
  })

  it('長すぎる市区町村は 400（集計を走らせない）', async () => {
    const response = await getRanking(
      request(`/api/ranking?metric=lp_near_price&municipality=${'あ'.repeat(41)}`),
    )
    expect(await errorOf(response)).toEqual({
      status: 400,
      message: expect.stringContaining('municipality は 40 文字までです'),
    })
    expect(db.rankByColumn).not.toHaveBeenCalled()
  })
})

function stationByGrpCalls(): number {
  return db.stationByGrp.mock.calls.length
}

describe('GET /api/ranking：起点の駅から N m 以内', () => {
  it('起点の座標はサーバが引き、SQL に座標と半径を渡す。応答は起点の名前と半径・各行に距離', async () => {
    const response = await getRanking(
      request(
        `/api/ranking?metric=lp_near_price&nearStation=${encodeURIComponent('竹橋#0')}&withinM=5000`,
      ),
    )
    expect(response.status).toBe(200)
    expect(db.stationByGrp).toHaveBeenCalledWith('竹橋#0')
    expect(rankFilter().near).toEqual({ lon: 139.75852, lat: 35.69028, radiusM: 5000 })
    const ranking = rankingResponseSchema.parse(await response.json())
    expect(ranking.near).toEqual({ grp: '竹橋#0', label: '竹橋', radiusM: 5000 })
    expect(ranking.rows.map((row) => [row.name, row.distM])).toEqual([
      ['新宿三丁目', 4882],
      ['竹橋', 0],
    ])
    // 「全国・竹橋から 5km」とは言わない
    expect(rankingPanel(ranking).title).toBe('最寄地価公示価格（2026年）（竹橋から 5km・上位）')
  })

  it.each([
    ['半径だけ', 'withinM=5000', '組で指定してください'],
    ['起点だけ', `nearStation=${encodeURIComponent('竹橋#0')}`, '組で指定してください'],
    [
      '知らない起点',
      `nearStation=${encodeURIComponent('無い駅#0')}&withinM=5000`,
      '知らない駅です',
    ],
  ])('%s → 400（集計を走らせない）', async (_label, query, message) => {
    const response = await getRanking(request(`/api/ranking?metric=lp_near_price&${query}`))
    expect(await errorOf(response)).toEqual({
      status: 400,
      message: expect.stringContaining(message),
    })
    expect(db.rankByColumn).not.toHaveBeenCalled()
  })

  it.each([['50'], ['100001'], ['1500.5'], ['abc']])(
    '半径 withinM=%s は 400（100〜100000 の整数）',
    async (withinM) => {
      const response = await getRanking(
        request(
          `/api/ranking?metric=lp_near_price&nearStation=${encodeURIComponent('竹橋#0')}&withinM=${withinM}`,
        ),
      )
      expect(await errorOf(response)).toEqual({
        status: 400,
        message: expect.stringContaining('withinM は 100〜100000 の整数（m）で指定してください'),
      })
      expect(db.stationByGrp).not.toHaveBeenCalled()
      expect(db.rankByColumn).not.toHaveBeenCalled()
    },
  )

  it.each([['100'], ['100000']])('半径の端 withinM=%s は受ける', async (withinM) => {
    const response = await getRanking(
      request(
        `/api/ranking?metric=lp_near_price&nearStation=${encodeURIComponent('竹橋#0')}&withinM=${withinM}`,
      ),
    )
    expect(response.status).toBe(200)
    expect(rankFilter().near?.radiusM).toBe(Number(withinM))
  })
})

describe('GET /api/ranking：範囲（bbox）', () => {
  it('「西,南,東,北」が SQL に届き、題は「地図の表示範囲」', async () => {
    const response = await getRanking(
      request('/api/ranking?metric=lp_near_price&bbox=139.5,35.4,139.8,35.6'),
    )
    expect(response.status).toBe(200)
    expect(rankFilter().bbox).toEqual({ west: 139.5, south: 35.4, east: 139.8, north: 35.6 })
    const ranking = rankingResponseSchema.parse(await response.json())
    expect(ranking.bbox).toEqual({ west: 139.5, south: 35.4, east: 139.8, north: 35.6 })
    expect(rankingPanel(ranking).title).toBe('最寄地価公示価格（2026年）（地図の表示範囲・上位）')
  })

  it.each([
    ['西と東が逆', '139.8,35.4,139.5,35.6'],
    ['3 つ', '139.5,35.4,139.8'],
    ['数でない', '139.5,35.4,東,35.6'],
    ['緯度の外', '139.5,35.4,139.8,95'],
  ])('%s → 400（直し方を言う・集計を走らせない）', async (_label, bbox) => {
    const response = await getRanking(request(`/api/ranking?metric=lp_near_price&bbox=${bbox}`))
    expect(await errorOf(response)).toEqual({
      status: 400,
      message: expect.stringContaining('bbox は「西,南,東,北」の 4 つの数'),
    })
    expect(db.rankByColumn).not.toHaveBeenCalled()
  })
})

describe('GET /api/ranking：場所の条件は AND・題は広い順', () => {
  it('都道府県・市区町村・起点・範囲をすべて渡すと、すべて SQL に届き、題は広い順に並ぶ', async () => {
    const response = await getRanking(
      request(
        `/api/ranking?metric=lp_near_price&prefecture=${encodeURIComponent('東京都')}&municipality=${encodeURIComponent('千代田区')}&nearStation=${encodeURIComponent('竹橋#0')}&withinM=1500&bbox=139.7,35.6,139.8,35.7`,
      ),
    )
    expect(response.status).toBe(200)
    expect(rankFilter()).toMatchObject({
      prefectures: ['東京都'],
      municipality: '千代田区',
      bbox: { west: 139.7, south: 35.6, east: 139.8, north: 35.7 },
      near: { lon: 139.75852, lat: 35.69028, radiusM: 1500 },
    })
    const ranking = rankingResponseSchema.parse(await response.json())
    expect(rankingPanel(ranking).title).toBe(
      '最寄地価公示価格（2026年）（東京都・千代田区・竹橋から 1.5km・地図の表示範囲・上位）',
    )
  })
})

describe('GET /api/growth：ランキングと同じ条件', () => {
  it('市区町村・起点・範囲が SQL に届き、応答と題に場所が入る', async () => {
    const response = await getGrowth(
      request(
        `/api/growth?x=pop_gr_2020_2015_1km&y=rate_covid&municipality=${encodeURIComponent('横浜市港北区')}&nearStation=${encodeURIComponent('竹橋#0')}&withinM=800&bbox=139.5,35.4,139.8,35.6`,
      ),
    )
    expect(response.status).toBe(200)
    const filter: unknown = db.scatterPoints.mock.calls[0]?.[4]
    expect(filter).toMatchObject({
      municipality: '横浜市港北区',
      bbox: { west: 139.5, south: 35.4, east: 139.8, north: 35.6 },
      near: { lon: 139.75852, lat: 35.69028, radiusM: 800 },
    })
    const growth = growthResponseSchema.parse(await response.json())
    expect(growth).toMatchObject({
      municipality: '横浜市港北区',
      near: { grp: '竹橋#0', label: '竹橋', radiusM: 800 },
    })
    expect(scatterPanel(growth).title).toContain('（横浜市港北区・竹橋から 800m・地図の表示範囲）')
  })

  it('形の崩れた範囲は 400（散布の集計を走らせない）', async () => {
    const response = await getGrowth(
      request('/api/growth?x=pop_gr_2020_2015_1km&y=rate_covid&bbox=1,2,3'),
    )
    expect((await errorOf(response)).status).toBe(400)
    expect(db.scatterPoints).not.toHaveBeenCalled()
  })

  it('場所を指定しなければ、応答の場所はどれも null（古い受け手も読める形）', async () => {
    const response = await getGrowth(request('/api/growth?x=pop_gr_2020_2015_1km&y=rate_covid'))
    const growth = growthResponseSchema.parse(await response.json())
    expect(growth).toMatchObject({ municipality: null, bbox: null, near: null })
    expect(scatterPanel(growth).title).toContain('（全国）')
    expect(db.stationByGrp).not.toHaveBeenCalled()
  })
})

describe('GET /api/stations：一覧の起点・範囲', () => {
  it('起点の駅から N m 以内の一覧。各駅に起点からの距離', async () => {
    const response = await getStations(
      request(`/api/stations?nearStation=${encodeURIComponent('竹橋#0')}&withinM=3000`),
    )
    expect(response.status).toBe(200)
    expect(db.listStations.mock.calls[0]?.[0]).toMatchObject({
      near: { lon: 139.75852, lat: 35.69028, radiusM: 3000 },
    })
    const [item] = stationListItemSchema.array().parse(await response.json())
    expect(item?.distM).toBe(1234)
  })

  it('一覧のときは bbox も絞り込みとして効く（市区町村と AND）', async () => {
    await getStations(
      request(
        `/api/stations?municipality=${encodeURIComponent('横浜市')}&bbox=139.5,35.4,139.8,35.6`,
      ),
    )
    expect(db.listStations.mock.calls[0]?.[0]).toMatchObject({
      municipality: '横浜市',
      bbox: { west: 139.5, south: 35.4, east: 139.8, north: 35.6 },
    })
  })

  it('一覧の範囲が崩れていれば 400。起点と半径は組で', async () => {
    const reversed = await getStations(
      request(
        `/api/stations?municipality=${encodeURIComponent('横浜市')}&bbox=139.8,35.4,139.5,35.6`,
      ),
    )
    expect((await errorOf(reversed)).status).toBe(400)
    const alone = await getStations(request('/api/stations?withinM=3000'))
    expect(await errorOf(alone)).toEqual({
      status: 400,
      message: expect.stringContaining('組で指定してください'),
    })
    expect(db.listStations).not.toHaveBeenCalled()
  })
})
