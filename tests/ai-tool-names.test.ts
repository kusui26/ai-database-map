/**
 * ツール（ランキング・散布・駅の一覧）が会社・路線の名前を正式名へ解決し、決まらない・0 件のときは
 * **図を作らない**ことを、DB を差し替えて確かめる（2026-10-07・B1・`docs/261001_fix_user_feedback_ui.md` §6.4）。
 *
 * 2026-10-01 の本番では、AI が `routes:["東急東横線"]`・`["中央線快速"]` を渡して 0 件の空の順位表を出し、
 * 当てずっぽうの呼び直しを 5〜6 回繰り返していた（§6.1）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type RankRow, type ScatterRow } from '@/db/queries'
import { type StationListItem } from '@/shared/api'

const db = vi.hoisted(() => ({
  rankByColumn: vi.fn(),
  scatterPoints: vi.fn(),
  listStations: vi.fn(),
  routeNames: vi.fn(),
  operatorNames: vi.fn(),
}))

vi.mock('@/db/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/queries')>()
  return { ...actual, ...db }
})

const { TOOL_SPECS } = await import('@/ai/tool-specs')
const { clearRouteNameCache } = await import('@/ai/routes/catalog')

const CTX = { origin: 'http://localhost:3000' }

const ROUTES = [
  { route: '東横線', stationCount: 21, operators: ['東急電鉄'], routeTypes: [4] },
  { route: '4号線丸ノ内線', stationCount: 25, operators: ['東京地下鉄'], routeTypes: [3] },
  { route: '4号線丸ノ内線分岐線', stationCount: 4, operators: ['東京地下鉄'], routeTypes: [3] },
  { route: '5号線東西線', stationCount: 23, operators: ['東京地下鉄'], routeTypes: [3] },
  { route: '東西線', stationCount: 49, operators: ['京都市', '仙台市', '札幌市'], routeTypes: [3] },
]
const OPERATORS = [
  { name: '東急電鉄', stationCount: 98, prefectures: ['東京都', '神奈川県'] },
  { name: '東京地下鉄', stationCount: 144, prefectures: ['東京都', '千葉県', '埼玉県'] },
  { name: '京都市', stationCount: 31, prefectures: ['京都府'] },
  { name: '仙台市', stationCount: 29, prefectures: ['宮城県'] },
  { name: '札幌市', stationCount: 46, prefectures: ['北海道'] },
]

const RANK_ROWS: RankRow[] = [
  { grp: '渋谷#0', stationName: '渋谷', prefecture: '東京都', value: 12.3, flagValue: 0, rank: 1 },
]
const SCATTER_ROWS: ScatterRow[] = [
  { grp: '渋谷#0', stationName: '渋谷', x: 5, y: -3, xFlag: 0, yFlag: 0 },
  { grp: '横浜#0', stationName: '横浜', x: 8, y: -6, xFlag: 0, yFlag: 0 },
]

function station(grp: string, prefecture: string): StationListItem {
  return {
    grp,
    stationName: grp.replace(/#\d+$/u, ''),
    label: grp.replace(/#\d+$/u, ''),
    prefecture,
    municipality: null,
    municipalityCode: null,
    lon: 139.7,
    lat: 35.6,
    nOp: 1,
    paxLatest: null,
  }
}

beforeEach(() => {
  clearRouteNameCache()
  db.routeNames.mockResolvedValue(ROUTES)
  db.operatorNames.mockResolvedValue(OPERATORS)
  db.rankByColumn.mockResolvedValue({ rows: RANK_ROWS, total: RANK_ROWS.length })
  db.scatterPoints.mockResolvedValue(SCATTER_ROWS)
  // 候補の駅：会社 × 路線ごとに 1 駅（都道府県は会社の地元）
  db.listStations.mockImplementation(
    async (filter: { operators?: readonly string[]; prefectures?: readonly string[] }) => {
      const home: Readonly<Record<string, string>> = {
        東京地下鉄: '東京都',
        京都市: '京都府',
        仙台市: '宮城県',
        札幌市: '北海道',
        東急電鉄: '東京都',
      }
      const rows = (filter.operators ?? []).map((op) => station(`${op}駅#0`, home[op] ?? '東京都'))
      const prefs = filter.prefectures ?? []
      return prefs.length === 0 ? rows : rows.filter((row) => prefs.includes(row.prefecture))
    },
  )
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('rankStations：名前の解決', () => {
  it('「東急東横線」を正式名「東横線」で集計し、読み替えを nameNotes に残す', async () => {
    const result = await TOOL_SPECS.rankStations.run(
      { metric: 'pop_gr', routes: ['東急東横線'] },
      CTX,
    )
    const [, , , , , , operators, routes] = db.rankByColumn.mock.calls[0] ?? []
    expect(operators).toEqual([])
    expect(routes).toEqual(['東横線'])
    expect(result.effects).toHaveLength(1)
    expect(JSON.stringify(result.forLlm)).toContain('東急電鉄 東横線')
  })

  it('同じ名前の別路線（東西線）は図を作らず、集計もせずに候補を返す', async () => {
    const result = await TOOL_SPECS.rankStations.run({ metric: 'pop_gr', routes: ['東西線'] }, CTX)
    expect(result.effects).toEqual([])
    expect(db.rankByColumn).not.toHaveBeenCalled()
    expect(result.forLlm).toMatchObject({ problems: [{ input: '東西線' }] })
    expect(JSON.stringify(result.forLlm)).toContain('5号線東西線')
  })

  it('地域が分かれば 1 本に決まる（東西線 × 東京都 → 東京メトロ）', async () => {
    const result = await TOOL_SPECS.rankStations.run(
      { metric: 'pop_gr', routes: ['東西線'], prefectures: ['東京都'] },
      CTX,
    )
    const [, prefectures, , , , , , routes] = db.rankByColumn.mock.calls[0] ?? []
    expect(prefectures).toEqual(['東京都'])
    expect(routes).toEqual(['5号線東西線'])
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

  it('0 件なら図を作らない（空の順位表を出さない）', async () => {
    db.rankByColumn.mockResolvedValue({ rows: [], total: 0 })
    const result = await TOOL_SPECS.rankStations.run(
      { metric: 'pop_gr', routes: ['東横線'], excludeLowN: true },
      CTX,
    )
    expect(result.effects).toEqual([])
    expect(result.forLlm).toMatchObject({
      total: 0,
      conditions: { routes: ['東横線'], excludeLowN: true },
    })
  })

  it('名前を渡さなければ一覧を読まない（いつもの呼び出しを遅くしない）', async () => {
    await TOOL_SPECS.rankStations.run({ metric: 'pop_gr', prefectures: ['東京都'] }, CTX)
    expect(db.routeNames).not.toHaveBeenCalled()
    expect(db.operatorNames).not.toHaveBeenCalled()
  })
})

describe('compareGrowth：名前の解決と 0 件', () => {
  it('「東京メトロ」は会社の正式名へ', async () => {
    await TOOL_SPECS.compareGrowth.run(
      { x: 'pop_gr', y: 'rate_covid', operators: ['東京メトロ'] },
      CTX,
    )
    const filters = db.scatterPoints.mock.calls[0]?.[4]
    expect(filters).toMatchObject({ operators: ['東京地下鉄'], routes: [] })
  })

  it('点が 0 なら図を作らない', async () => {
    db.scatterPoints.mockResolvedValue([])
    const result = await TOOL_SPECS.compareGrowth.run({ x: 'pop_gr', y: 'rate_covid' }, CTX)
    expect(result.effects).toEqual([])
    expect(result.forLlm).toMatchObject({ total: 0 })
  })
})

describe('listStations：同じ解決を通る', () => {
  it('「丸ノ内線」→ 4号線丸ノ内線と分岐線（方南町）', async () => {
    const result = await TOOL_SPECS.listStations.run({ routes: ['丸ノ内線'] }, CTX)
    const filter = db.listStations.mock.calls.at(-1)?.[0]
    expect(filter).toMatchObject({ routes: ['4号線丸ノ内線', '4号線丸ノ内線分岐線'] })
    expect(result.forLlm).toMatchObject({ nameNotes: [expect.stringContaining('4号線丸ノ内線')] })
  })
})

describe('一覧のキャッシュ', () => {
  it('続けて呼んでも一覧は 1 回だけ読む。消せば読み直す', async () => {
    await TOOL_SPECS.rankStations.run({ metric: 'pop_gr', routes: ['東横線'] }, CTX)
    await TOOL_SPECS.rankStations.run({ metric: 'pop_gr', routes: ['丸ノ内線'] }, CTX)
    expect(db.routeNames).toHaveBeenCalledTimes(1)
    clearRouteNameCache()
    await TOOL_SPECS.rankStations.run({ metric: 'pop_gr', routes: ['東横線'] }, CTX)
    expect(db.routeNames).toHaveBeenCalledTimes(2)
  })

  it('読めなかったときは持たない（次の呼び出しで読み直す）', async () => {
    db.routeNames.mockRejectedValueOnce(new Error('DB に届かない'))
    await expect(
      TOOL_SPECS.rankStations.run({ metric: 'pop_gr', routes: ['東横線'] }, CTX),
    ).rejects.toThrow('DB に届かない')
    const result = await TOOL_SPECS.rankStations.run({ metric: 'pop_gr', routes: ['東横線'] }, CTX)
    expect(result.effects).toHaveLength(1)
    expect(db.routeNames).toHaveBeenCalledTimes(2)
  })
})
