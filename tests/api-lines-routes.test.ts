/**
 * 共通 API の路線（運行系統）——`GET /api/lines` と、ランキング・散布・駅の一覧・おすすめの条件 `lines`
 * （261008 L2・docs/261001_fix_user_feedback_ui.md §6.8）を、DB を差し替えて本物のルートで確かめる。
 *
 * 見ること：
 * - 路線コードが SQL まで届く（`line_cds`）・応答に名前つきで返る
 * - 知らないコード・数でないコードは 400 で、**集計を走らせない**（別の駅の集合で答えない）
 * - `lines` を指定しないときは名前を引きにも行かない（いつもの呼び出しを遅くしない）
 *
 * SQL そのもの（述語・RPC）は `pipeline/golden_lines_test.py` が本物の DB で確かめる。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type LineRow, type RankRow, type ScatterRow } from '@/db/queries'
import { linesResponseSchema, type LineRef, type StationListItem } from '@/shared/api'

const db = vi.hoisted(() => ({
  rankByColumn: vi.fn(),
  scatterPoints: vi.fn(),
  listStations: vi.fn(),
  lineNames: vi.fn(),
  linesByCodes: vi.fn(),
}))

vi.mock('@/db/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/queries')>()
  return { ...actual, ...db }
})

const { GET: getLines } = await import('@/app/api/lines/route')
const { GET: getRanking } = await import('@/app/api/ranking/route')
const { GET: getGrowth } = await import('@/app/api/growth/route')
const { GET: getStations } = await import('@/app/api/stations/route')
const { GET: getRecommend } = await import('@/app/api/recommend/route')
const { resetRateLimitStore } = await import('@/ai/rate-limit')

const YAMANOTE: LineRef = { lineCd: 11302, name: 'JR山手線' }
const FUKUTOSHIN: LineRef = { lineCd: 28010, name: '東京メトロ副都心線' }
const KNOWN = [YAMANOTE, FUKUTOSHIN]

const RANK_ROWS: RankRow[] = [
  { grp: '東京#0', stationName: '東京', prefecture: '東京都', value: 30000, flagValue: 0, rank: 1 },
]
const SCATTER_ROWS: ScatterRow[] = [
  { grp: '渋谷#0', stationName: '渋谷', x: 5, y: -3, xFlag: 0, yFlag: 0 },
  { grp: '池袋#0', stationName: '池袋', x: 8, y: -6, xFlag: 0, yFlag: 0 },
]
const LINE_ROWS: LineRow[] = [
  {
    lineCd: 11302,
    name: 'JR山手線',
    formalName: 'JR山手線',
    companyName: 'JR東日本',
    companyShort: 'JR東日本',
    operator: '東日本旅客鉄道',
    color: '#80C241',
    colorName: '黄緑',
    lineType: 2,
    isLoop: true,
    stationCount: 30,
    prefectures: ['東京都'],
    source: '駅データ.jp 2024-04-26',
  },
]

function station(index: number): StationListItem {
  return {
    grp: `駅${index}#0`,
    stationName: `駅${index}`,
    label: `駅${index}`,
    prefecture: '東京都',
    municipality: null,
    municipalityCode: null,
    lon: 139.7,
    lat: 35.6,
    nOp: 1,
    paxLatest: null,
  }
}

function request(path: string): Request {
  return new Request(`http://localhost${path}`, { headers: { 'x-real-ip': '10.0.0.9' } })
}

async function body(response: Response): Promise<Record<string, unknown>> {
  const parsed: unknown = await response.json()
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`オブジェクトではない: ${JSON.stringify(parsed)}`)
  }
  return Object.fromEntries(Object.entries(parsed))
}

async function errorMessage(response: Response): Promise<string> {
  return JSON.stringify(await body(response))
}

beforeEach(() => {
  resetRateLimitStore()
  db.linesByCodes.mockImplementation(async (codes: readonly number[]) =>
    KNOWN.filter((line) => codes.includes(line.lineCd)),
  )
  db.lineNames.mockResolvedValue(LINE_ROWS)
  db.rankByColumn.mockResolvedValue({ rows: RANK_ROWS, total: 1 })
  db.scatterPoints.mockResolvedValue(SCATTER_ROWS)
  db.listStations.mockResolvedValue([station(1)])
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/lines：路線（運行系統）の一覧', () => {
  it('表示名・出典つきで返し、1 日キャッシュ', async () => {
    const response = await getLines()
    expect(response.status).toBe(200)
    const parsed = linesResponseSchema.parse(await response.json())
    expect(parsed.lines[0]).toMatchObject({
      lineCd: 11302,
      name: 'JR山手線',
      lineTypeLabel: '一般',
      isLoop: true,
    })
    expect(parsed.source).toBe('駅データ.jp 2024-04-26')
    expect(response.headers.get('cache-control')).toContain('s-maxage=86400')
  })
})

describe('GET /api/ranking：lines', () => {
  it('路線コードが SQL まで届き、応答に名前つきで返る', async () => {
    const response = await getRanking(request('/api/ranking?metric=pop_2020_1km&lines=11302,28010'))
    expect(response.status).toBe(200)
    expect(db.rankByColumn.mock.calls[0]?.[1]?.lines).toEqual([11302, 28010])
    expect((await body(response)).lines).toEqual([YAMANOTE, FUKUTOSHIN])
  })

  it('知らないコードは 400 で、集計を走らせない', async () => {
    const response = await getRanking(request('/api/ranking?metric=pop_2020_1km&lines=11302,99999'))
    expect(response.status).toBe(400)
    expect(await errorMessage(response)).toContain('99999')
    expect(db.rankByColumn).not.toHaveBeenCalled()
  })

  it('数でないコードは 400 で、名前も引きに行かない', async () => {
    const response = await getRanking(request('/api/ranking?metric=pop_2020_1km&lines=山手線'))
    expect(response.status).toBe(400)
    expect(await errorMessage(response)).toContain('/api/lines')
    expect(db.linesByCodes).not.toHaveBeenCalled()
    expect(db.rankByColumn).not.toHaveBeenCalled()
  })

  it('lines を指定しなければ名前を引きに行かず、SQL には空で渡る（以前と同じ集計）', async () => {
    const response = await getRanking(request('/api/ranking?metric=pop_2020_1km'))
    expect(response.status).toBe(200)
    expect(db.linesByCodes).not.toHaveBeenCalled()
    expect(db.rankByColumn.mock.calls[0]?.[1]?.lines).toEqual([])
    expect((await body(response)).lines).toEqual([])
  })
})

describe('GET /api/growth：lines', () => {
  it('路線コードが散布の条件に入り、応答に名前つきで返る', async () => {
    const response = await getGrowth(
      request('/api/growth?x=pop_gr_2020_2015_1km&y=lp_gr_2026_2021_1km&lines=28010'),
    )
    expect(response.status).toBe(200)
    expect(db.scatterPoints.mock.calls[0]?.[4]).toMatchObject({ lines: [28010] })
    expect((await body(response)).lines).toEqual([FUKUTOSHIN])
  })

  it('知らないコードは 400 で、散布を走らせない', async () => {
    const response = await getGrowth(
      request('/api/growth?x=pop_gr_2020_2015_1km&y=lp_gr_2026_2021_1km&lines=12345'),
    )
    expect(response.status).toBe(400)
    expect(db.scatterPoints).not.toHaveBeenCalled()
  })
})

describe('GET /api/stations：lines で駅の一覧', () => {
  it('lines だけでも一覧になり、路線コードが条件に入る', async () => {
    const response = await getStations(request('/api/stations?lines=11302&limit=100'))
    expect(response.status).toBe(200)
    expect(db.listStations.mock.calls[0]?.[0]).toMatchObject({ lines: [11302], limit: 100 })
  })

  it('知らないコードは 400', async () => {
    const response = await getStations(request('/api/stations?lines=11302,777'))
    expect(response.status).toBe(400)
    expect(await errorMessage(response)).toContain('777')
    expect(db.listStations).not.toHaveBeenCalled()
  })
})

describe('GET /api/recommend：lines', () => {
  it('路線だけでも「絞り込み」になり、路線コードが候補の条件に届く', async () => {
    // 候補が上限（800）を超える形にして、重いクエリの手前で止める（ここで見るのは条件の受け渡し）。
    db.listStations.mockResolvedValue(Array.from({ length: 801 }, (_, i) => station(i)))
    const response = await getRecommend(request('/api/recommend?lines=11302'))
    expect(response.status).toBe(400)
    expect(await errorMessage(response)).toContain('800 駅を超えました')
    expect(db.listStations.mock.calls[0]?.[0]).toMatchObject({ lines: [11302] })
  })

  it('知らないコードは 400 で、候補を集めに行かない', async () => {
    const response = await getRecommend(request('/api/recommend?lines=424242'))
    expect(response.status).toBe(400)
    expect(await errorMessage(response)).toContain('424242')
    expect(db.listStations).not.toHaveBeenCalled()
  })
})
