/**
 * ツール（ランキング・散布・駅の一覧・データセット）が会社・路線の名前を解決し、路線は**路線コード**
 * （運行系統・`lines`）で絞ること、決まらない・0 件のときは**図を作らない**ことを、DB を差し替えて確かめる
 * （2026-10-07 B1 → 2026-10-08 L3・`docs/261001_fix_user_feedback_ui.md` §6.4・§6.8）。
 *
 * 2026-10-01 の本番では、AI が `routes:["東急東横線"]`・`["中央線快速"]` を渡して 0 件の空の順位表を出し、
 * 当てずっぽうの呼び直しを 5〜6 回繰り返していた（§6.1）。B1 で名前は解決できたが、行き先が法令上の路線で
 * 「山手線」は 17 駅だった（§6.8.1）。L3 で行き先を路線（運行系統）に替え、同じ名前の路線は地図の範囲で決める。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type ListStationsFilter, type RankRow, type ScatterRow } from '@/db/queries'
import { type StationListItem } from '@/shared/api'
import { datasetSecret, verifyDatasetToken } from '@/ai/dataset/token'
import {
  LEGAL_ROUTES,
  OPERATORS,
  VIEW,
  hasStationsInView,
  lineRows,
  stationCountOf,
} from './fixtures/line-catalog'

const db = vi.hoisted(() => ({
  rankByColumn: vi.fn(),
  scatterPoints: vi.fn(),
  listStations: vi.fn(),
  datasetRows: vi.fn(),
  lineNames: vi.fn(),
  operatorNames: vi.fn(),
  routeNames: vi.fn(),
}))

vi.mock('@/db/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/queries')>()
  return { ...actual, ...db }
})

const { TOOL_SPECS } = await import('@/ai/tool-specs')
const { clearRouteNameCache } = await import('@/ai/routes/catalog')

const CTX = { origin: 'http://localhost:3000' }

const RANK_ROWS: RankRow[] = [
  { grp: '渋谷#0', stationName: '渋谷', prefecture: '東京都', value: 12.3, flagValue: 0, rank: 1 },
]
const SCATTER_ROWS: ScatterRow[] = [
  { grp: '渋谷#0', stationName: '渋谷', x: 5, y: -3, xFlag: 0, yFlag: 0 },
  { grp: '横浜#0', stationName: '横浜', x: 8, y: -6, xFlag: 0, yFlag: 0 },
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

/** 駅の一覧の代わり：範囲（bbox）があれば範囲に駅があるか、無ければ路線の駅の数だけ駅を返す。 */
async function fakeListStations(filter: ListStationsFilter): Promise<StationListItem[]> {
  const codes = filter.lines ?? []
  if (filter.bbox !== undefined) {
    return hasStationsInView(codes, filter.bbox) ? [station(0)] : []
  }
  const count = codes.length > 0 ? stationCountOf(codes) : 3
  return Array.from({ length: count }, (_, i) => station(i))
}

beforeEach(() => {
  clearRouteNameCache()
  db.lineNames.mockResolvedValue(lineRows())
  db.operatorNames.mockResolvedValue(OPERATORS)
  db.routeNames.mockResolvedValue(
    LEGAL_ROUTES.map((row) => ({ ...row, stationCount: 1, routeTypes: [4] })),
  )
  db.rankByColumn.mockResolvedValue({ rows: RANK_ROWS, total: RANK_ROWS.length })
  db.scatterPoints.mockResolvedValue(SCATTER_ROWS)
  db.listStations.mockImplementation(fakeListStations)
  db.datasetRows.mockResolvedValue(new Map())
})

afterEach(() => {
  vi.clearAllMocks()
})

/** `rankByColumn` に渡った条件（会社・法令上の路線・路線コード）。 */
function rankedWith(): { operators: unknown; routes: unknown; lines: unknown } {
  const call = db.rankByColumn.mock.calls[0] ?? []
  return { operators: call[6], routes: call[7], lines: call[9] }
}

describe('rankStations：路線は路線コードで絞る', () => {
  it('「東急東横線」→ 路線コード 26001。法令上の路線・会社は条件に入れない', async () => {
    const result = await TOOL_SPECS.rankStations.run(
      { metric: 'pop_gr', routes: ['東急東横線'] },
      CTX,
    )
    expect(rankedWith()).toEqual({ operators: [], routes: [], lines: [26001] })
    expect(result.effects).toHaveLength(1)
    expect(result.forLlm).toMatchObject({ routes: ['東急東横線'] })
  })

  it('図の応答（題・⤢ の条件の元）に路線が名前つきで載る', async () => {
    const result = await TOOL_SPECS.rankStations.run(
      { metric: 'pop_gr', routes: ['副都心線'] },
      CTX,
    )
    const [effect] = result.effects
    expect(effect?.kind === 'ranking' && effect.response.lines).toEqual([
      { lineCd: 28010, name: '東京メトロ副都心線' },
    ])
    expect(JSON.stringify(result.forLlm)).toContain('東京メトロ副都心線 として集計しました')
  })

  it('同じ名前の路線（山手線）は、地図の表示範囲で決める（首都圏 → JR山手線）', async () => {
    const result = await TOOL_SPECS.rankStations.run(
      { metric: 'lp_near_price', routes: ['山手線'] },
      { ...CTX, viewport: VIEW.tokyo },
    )
    expect(rankedWith().lines).toEqual([11302])
    expect(JSON.stringify(result.forLlm)).toContain('地図の表示範囲に駅のある JR山手線')
  })

  it('大阪の地図なら「中央線」は大阪メトロ中央線（聞き返さない）', async () => {
    await TOOL_SPECS.rankStations.run(
      { metric: 'lp_near_price', routes: ['中央線'] },
      { ...CTX, viewport: VIEW.osaka },
    )
    expect(rankedWith().lines).toEqual([99621])
  })

  it('地図の範囲に 2 本（新宿線）なら図を作らず、集計もせずに候補を返す', async () => {
    const result = await TOOL_SPECS.rankStations.run(
      { metric: 'pop_gr', routes: ['新宿線'] },
      { ...CTX, viewport: VIEW.tokyo },
    )
    expect(result.effects).toEqual([])
    expect(db.rankByColumn).not.toHaveBeenCalled()
    expect(result.forLlm).toMatchObject({ problems: [{ input: '新宿線' }] })
    expect(JSON.stringify(result.forLlm)).toContain('西武新宿線')
  })

  it('地図が無ければ（MCP）、同じ名前の路線は候補を返す', async () => {
    const result = await TOOL_SPECS.rankStations.run({ metric: 'pop_gr', routes: ['東西線'] }, CTX)
    expect(result.effects).toEqual([])
    expect(JSON.stringify(result.forLlm)).toContain('東京メトロ東西線')
  })

  it('地域が分かれば 1 本に決まる（東西線 × 東京都 → 東京メトロ）', async () => {
    const result = await TOOL_SPECS.rankStations.run(
      { metric: 'pop_gr', routes: ['東西線'], prefectures: ['東京都'] },
      CTX,
    )
    const [, prefectures] = db.rankByColumn.mock.calls[0] ?? []
    expect(prefectures).toEqual(['東京都'])
    expect(rankedWith().lines).toEqual([28004])
    expect(result.effects).toHaveLength(1)
  })

  it('事業者名に「新幹線」は、図を作らずに routeTypes の使い方を返す', async () => {
    const result = await TOOL_SPECS.rankStations.run(
      { metric: 'pop_gr', operators: ['新幹線'] },
      CTX,
    )
    expect(result.effects).toEqual([])
    expect(JSON.stringify(result.forLlm)).toContain('routeTypes:[1]')
  })

  it('0 件なら図を作らない（条件には路線の名前を返す）', async () => {
    db.rankByColumn.mockResolvedValue({ rows: [], total: 0 })
    const result = await TOOL_SPECS.rankStations.run(
      { metric: 'pop_gr', routes: ['東横線'], excludeLowN: true },
      CTX,
    )
    expect(result.effects).toEqual([])
    expect(result.forLlm).toMatchObject({
      total: 0,
      conditions: { routes: ['東急東横線'], excludeLowN: true },
    })
  })

  it('名前を渡さなければ一覧を読まない（いつもの呼び出しを遅くしない）', async () => {
    await TOOL_SPECS.rankStations.run({ metric: 'pop_gr', prefectures: ['東京都'] }, CTX)
    expect(db.lineNames).not.toHaveBeenCalled()
    expect(db.operatorNames).not.toHaveBeenCalled()
    expect(db.routeNames).not.toHaveBeenCalled()
    expect(rankedWith()).toEqual({ operators: [], routes: [], lines: [] })
  })
})

describe('compareGrowth：名前の解決と 0 件', () => {
  it('「東京メトロ」は会社の正式名へ（会社だけなら路線コードは無い）', async () => {
    await TOOL_SPECS.compareGrowth.run(
      { x: 'pop_gr', y: 'rate_covid', operators: ['東京メトロ'] },
      CTX,
    )
    const filters = db.scatterPoints.mock.calls[0]?.[4]
    expect(filters).toMatchObject({ operators: ['東京地下鉄'], routes: [], lines: [] })
  })

  it('路線は路線コードで散布の条件に入り、応答に名前つきで載る', async () => {
    const result = await TOOL_SPECS.compareGrowth.run(
      { x: 'pop_gr', y: 'rate_covid', routes: ['副都心線'] },
      { ...CTX, viewport: VIEW.tokyo },
    )
    expect(db.scatterPoints.mock.calls[0]?.[4]).toMatchObject({ lines: [28010], routes: [] })
    const [effect] = result.effects
    expect(effect?.kind === 'growth' && effect.response.lines).toEqual([
      { lineCd: 28010, name: '東京メトロ副都心線' },
    ])
  })

  it('点が 0 なら図を作らない', async () => {
    db.scatterPoints.mockResolvedValue([])
    const result = await TOOL_SPECS.compareGrowth.run({ x: 'pop_gr', y: 'rate_covid' }, CTX)
    expect(result.effects).toEqual([])
    expect(result.forLlm).toMatchObject({ total: 0 })
  })
})

describe('listStations：同じ解決を通る', () => {
  it('「丸ノ内線」→ 東京メトロ丸ノ内線（方南町の支線を含む 1 本）の路線コードで一覧', async () => {
    const result = await TOOL_SPECS.listStations.run({ routes: ['丸ノ内線'] }, CTX)
    const filter = db.listStations.mock.calls.at(-1)?.[0]
    expect(filter).toMatchObject({ lines: [28002], operators: [] })
    expect(filter?.routes).toBeUndefined()
    expect(result.forLlm).toMatchObject({
      nameNotes: [expect.stringContaining('東京メトロ丸ノ内線')],
    })
  })

  it('セレクタの bbox（駅を範囲で絞る）と、地図の表示範囲（名前を決める）は別物', async () => {
    const bbox: [number, number, number, number] = [139.6, 35.6, 139.8, 35.8]
    await TOOL_SPECS.listStations.run(
      { routes: ['中央線'], bbox },
      { ...CTX, viewport: VIEW.osaka },
    )
    const filter = db.listStations.mock.calls.at(-1)?.[0]
    expect(filter).toMatchObject({
      lines: [99621],
      bbox: { west: 139.6, south: 35.6, east: 139.8, north: 35.8 },
    })
  })
})

describe('buildDataset：署名つきの条件に路線コードが入る（CSV を作り直しても同じ駅）', () => {
  it('stations.routes の「山手線」は路線コードで署名され、URL を開き直しても同じ条件', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await TOOL_SPECS.buildDataset.run(
      { stations: { routes: ['JR山手線'] }, metrics: ['pop_2020_1km'] },
      CTX,
    )
    const url = JSON.stringify(result.forLlm).match(/t=([^&"]+)/u)?.[1]
    expect(url).toBeDefined()
    const verified = verifyDatasetToken(url ?? '', { secret: datasetSecret(), now: Date.now() })
    expect(verified.ok && verified.query.selector).toMatchObject({ lines: [11302] })
    expect(verified.ok && verified.query.selector?.routes).toBeUndefined()
  })
})

describe('一覧のキャッシュ', () => {
  it('続けて呼んでも一覧は 1 回だけ読む。消せば読み直す', async () => {
    await TOOL_SPECS.rankStations.run({ metric: 'pop_gr', routes: ['東横線'] }, CTX)
    await TOOL_SPECS.rankStations.run({ metric: 'pop_gr', routes: ['丸ノ内線'] }, CTX)
    expect(db.lineNames).toHaveBeenCalledTimes(1)
    clearRouteNameCache()
    await TOOL_SPECS.rankStations.run({ metric: 'pop_gr', routes: ['東横線'] }, CTX)
    expect(db.lineNames).toHaveBeenCalledTimes(2)
  })

  it('読めなかったときは持たない（次の呼び出しで読み直す）', async () => {
    db.lineNames.mockRejectedValueOnce(new Error('DB に届かない'))
    await expect(
      TOOL_SPECS.rankStations.run({ metric: 'pop_gr', routes: ['東横線'] }, CTX),
    ).rejects.toThrow('DB に届かない')
    const result = await TOOL_SPECS.rankStations.run({ metric: 'pop_gr', routes: ['東横線'] }, CTX)
    expect(result.effects).toHaveLength(1)
    expect(db.lineNames).toHaveBeenCalledTimes(2)
  })
})
