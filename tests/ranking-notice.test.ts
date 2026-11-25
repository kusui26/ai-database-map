/**
 * 順位の行の**注意の印**（2026-11-25・計画書 261122 §8.2）。
 *
 * 年齢の順位では、都心の駅（年齢不詳が多く、年齢の構成の多くを補った値）が上に並ぶ（本番：「愛知県で生産年齢人口の割合が
 * 高い駅」は上位 20 のうち 14 駅）。順位の ⚠ と除外は除外のフラグのまま変えず、年齢不詳の注意だけを別の印（※）で出す。
 * ここで固定するのは：
 *
 * - 印を出すのは注意のフラグが年齢不詳の指標だけ（所得の政令市・コロナ前後比の被覆・ほかの指標は出さない）
 * - 印は印のある行だけ。印の意味は印のある行があるときだけ応答・パネル・AI の返却に載る
 * - 印を出さない指標・印の無い順位は、往復も応答も AI への返却も以前と同じ
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type RankRow } from '@/db/queries'
import { entries, requireEntry } from '@/shared/catalog'
import { type RankingTablePanel } from '@/shared/protocol'
import { AREA_STATIONS } from './fixtures/area-catalog'
import { LEGAL_ROUTES, OPERATORS, lineRows } from './fixtures/line-catalog'

const db = vi.hoisted(() => ({
  rankByColumn: vi.fn(),
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

const { rankingNoticeOf } = await import('@/domain/ranking/notice')
const { buildRanking } = await import('@/domain/ranking/presenter')
const { loadRanking } = await import('@/domain/ranking/load')
const { rankingPanel } = await import('@/domain/ranking/panel')
const { TOOL_SPECS } = await import('@/ai/tool-specs')
const { clearAreaCache } = await import('@/ai/area/catalog')
const { clearRouteNameCache } = await import('@/ai/routes/catalog')
const { clearOperatorLabelCache } = await import('@/domain/operators')
const { panelToVNode } = await import('@/shared/viewer/panels')
const { vnodeToHtml } = await import('@/shared/viewer/vnode')
const { toEChartsDocument } = await import('@/shared/presenters/echarts')
const { summarizePanels } = await import('@/ai/assemble')
const { mergeRankingPages } = await import('@/components/ranking/pages')

const AGE_KEY = 'pop15_64_share_2020_1km'
const AGE_FLAG = 'pop_ageunk_2020_1km'
const NOTICE_JA = '※ 年齢不詳が多い駅（年齢の構成の多くを補った値）'
const PAGE = { order: 'desc' as const, limit: 20, offset: 0, excludeLowN: false }

/** 名古屋の都心（年齢不詳が多い）と、そうでない駅。値は本番の 1km 圏に近い形。 */
const ROWS: RankRow[] = [
  { grp: '栄#2', stationName: '栄', prefecture: '愛知県', value: 74.8, flagValue: 0, rank: 1 },
  { grp: '金山#0', stationName: '金山', prefecture: '愛知県', value: 73.9, flagValue: 0, rank: 2 },
  {
    grp: '矢場町#0',
    stationName: '矢場町',
    prefecture: '愛知県',
    value: 73.9,
    flagValue: 0,
    rank: 3,
  },
]

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
  db.rankByColumn.mockResolvedValue({ rows: ROWS, total: 475 })
  db.datasetRows.mockResolvedValue({
    '栄#2': { [AGE_FLAG]: 1 },
    '金山#0': { [AGE_FLAG]: 0 },
    '矢場町#0': { [AGE_FLAG]: 1 },
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('rankingNoticeOf（どの指標の順位に印を出すか）', () => {
  it('年齢の指標は年齢不詳の注意を出す（実数・割合・増減率・将来）', () => {
    for (const key of [
      'pop15_64_2020_1km',
      'pop65_share_2020_1km',
      'pop15_64_gr_2020_2015_500m',
      'pop15_64_gr_pred_2024_2050_2km',
      'pop65_gr_pred_2024_2050_1km',
    ]) {
      expect(rankingNoticeOf(requireEntry(key))?.flagKey, key).toMatch(/^pop_ageunk_2020_/)
    }
    expect(rankingNoticeOf(requireEntry(AGE_KEY))).toEqual({
      flagKey: AGE_FLAG,
      noticeJa: NOTICE_JA,
    })
  })

  it('ほかの注意は出さない：所得の政令市（駅の置かれた条件）・コロナ前後比の被覆・注意＝除外の指標', () => {
    expect(rankingNoticeOf(requireEntry('inc_total_2015_500m'))).toBeNull()
    expect(rankingNoticeOf(requireEntry('rate_covid'))).toBeNull()
    expect(rankingNoticeOf(requireEntry('pop_gr_2020_2015_1km'))).toBeNull()
    // 2050 年の高齢化率は R6 だけで作る（国勢調査の年齢不詳が関わらない）。注意は母数のフラグで、⚠ が言う。
    expect(rankingNoticeOf(requireEntry('pop65_share_pred_2024_2050_1km'))).toBeNull()
  })

  it('カタログ全体で、印を出すのは注意のフラグが年齢不詳の指標だけ', () => {
    const noticed = entries.filter((entry) => rankingNoticeOf(entry) !== null)
    expect(noticed.length).toBeGreaterThan(0)
    for (const entry of noticed) expect(entry.noticeFlagKey, entry.key).toMatch(/^pop_ageunk_/)
    const ageunk = entries.filter(
      (entry) =>
        entry.noticeFlagKey?.startsWith('pop_ageunk_') === true &&
        entry.noticeFlagKey !== entry.reliabilityFlagKey,
    )
    expect(noticed.map((entry) => entry.key)).toEqual(ageunk.map((entry) => entry.key))
  })
})

describe('buildRanking（印のある行だけに印・意味は印があるときだけ）', () => {
  it('印のある駅の行だけ noticed を持ち、応答に印の意味が 1 つ載る', () => {
    const notice = { noticeJa: NOTICE_JA, grps: new Set(['栄#2', '矢場町#0']) }
    const response = buildRanking(AGE_KEY, ['愛知県'], 'desc', ROWS, 475, 0, { notice })
    expect(response.rows.map((row) => row.noticed)).toEqual([true, undefined, true])
    expect('noticed' in (response.rows[1] ?? {})).toBe(false)
    expect(response.noticeJa).toBe(NOTICE_JA)
  })

  it('並んだ駅に印が無ければ、印の意味も載らない（以前と同じ形）', () => {
    const notice = { noticeJa: NOTICE_JA, grps: new Set<string>() }
    const withEmpty = buildRanking(AGE_KEY, ['愛知県'], 'desc', ROWS, 475, 0, { notice })
    const without = buildRanking(AGE_KEY, ['愛知県'], 'desc', ROWS, 475, 0)
    expect(withEmpty).toEqual(without)
    expect(JSON.stringify(withEmpty)).toBe(JSON.stringify(without))
    expect('noticeJa' in without).toBe(false)
  })
})

describe('loadRanking（取得 → 注意の印 → 組み立て）', () => {
  it('年齢の指標は、並んだ駅の注意のフラグを 1 回だけ引いて印を付ける', async () => {
    const response = await loadRanking(AGE_KEY, ['愛知県'], { prefectures: ['愛知県'] }, PAGE)
    expect(db.datasetRows).toHaveBeenCalledTimes(1)
    expect(db.datasetRows).toHaveBeenCalledWith(['栄#2', '金山#0', '矢場町#0'], [AGE_FLAG])
    expect(response.rows.filter((row) => row.noticed === true).map((row) => row.name)).toEqual([
      '栄',
      '矢場町',
    ])
    expect(response.noticeJa).toBe(NOTICE_JA)
  })

  it('印を出さない指標は、注意のフラグを引かない（往復は以前と同じ 1 回）', async () => {
    const response = await loadRanking('pop_gr_2020_2015_1km', [], {}, PAGE)
    expect(db.rankByColumn).toHaveBeenCalledTimes(1)
    expect(db.datasetRows).not.toHaveBeenCalled()
    expect(response.rows.some((row) => 'noticed' in row)).toBe(false)
  })

  it('該当が 0 件なら引かない', async () => {
    db.rankByColumn.mockResolvedValue({ rows: [], total: 0 })
    const response = await loadRanking(AGE_KEY, [], {}, PAGE)
    expect(db.datasetRows).not.toHaveBeenCalled()
    expect(response.total).toBe(0)
  })
})

describe('mergeRankingPages（図の「もっと見る」・印のある駅が 2 ページ目から）', () => {
  const NEXT_ROWS: RankRow[] = [
    {
      grp: '三菱自工前#0',
      stationName: '三菱自工前',
      prefecture: '岡山県',
      value: 31.2,
      flagValue: 0,
      rank: 4,
    },
  ]
  function pageOf(rows: readonly RankRow[], noticed: readonly string[], offset: number) {
    const notice = { noticeJa: NOTICE_JA, grps: new Set(noticed) }
    return buildRanking(AGE_KEY, ['岡山県'], 'desc', rows, 4, offset, { notice })
  }

  it('印の意味が 2 ページ目にだけあっても拾う（1 ページ目だけを見ると ※ だけが出る）', () => {
    const merged = mergeRankingPages([pageOf(ROWS, [], 0), pageOf(NEXT_ROWS, ['三菱自工前#0'], 3)])
    expect(merged?.noticeJa).toBe(NOTICE_JA)
    expect(merged?.rows.map((row) => row.rank)).toEqual([1, 2, 3, 4])
    expect(merged?.rows.filter((row) => row.noticed === true).map((row) => row.name)).toEqual([
      '三菱自工前',
    ])
  })

  it('総数・先頭の位置は 1 ページ目のまま。どのページにも印が無ければ意味は載らない（以前と同じ形）', () => {
    const first = pageOf(ROWS, [], 0)
    const merged = mergeRankingPages([first, pageOf(NEXT_ROWS, [], 3)])
    expect(merged).toEqual({ ...first, rows: [...first.rows, ...pageOf(NEXT_ROWS, [], 3).rows] })
    expect(merged !== undefined && 'noticeJa' in merged).toBe(false)
    expect(mergeRankingPages([])).toBeUndefined()
  })
})

describe('rankStations の返却（AI・MCP）', () => {
  const CTX = { origin: 'http://localhost:3000' }

  it('印のある行に noticed、返却に印の意味（notice）が 1 つ', async () => {
    const result = await TOOL_SPECS.rankStations.run(
      { metric: AGE_KEY, prefectures: ['愛知県'] },
      CTX,
    )
    const forLlm: unknown = result.forLlm
    expect(forLlm).toMatchObject({
      notice: NOTICE_JA,
      rows: [
        { name: '栄', noticed: true },
        { name: '金山', flagged: false },
        { name: '矢場町', noticed: true },
      ],
    })
  })

  it('印の無い順位は、返却に notice も noticed も無い（以前と同じ）', async () => {
    db.datasetRows.mockResolvedValue({})
    const result = await TOOL_SPECS.rankStations.run(
      { metric: AGE_KEY, prefectures: ['愛知県'] },
      CTX,
    )
    const text = JSON.stringify(result.forLlm)
    expect(text).not.toContain('notice')
  })
})

describe('描き方（パネル・ビューア・ECharts）', () => {
  function panelOf(noticed: readonly string[]): RankingTablePanel {
    const notice = { noticeJa: NOTICE_JA, grps: new Set(noticed) }
    return rankingPanel(buildRanking(AGE_KEY, ['愛知県'], 'desc', ROWS, 475, 0, { notice }))
  }

  it('パネルは印があるときだけ印の意味を持つ', () => {
    expect(panelOf(['栄#2']).noticeJa).toBe(NOTICE_JA)
    expect('noticeJa' in panelOf([])).toBe(false)
  })

  it('ビューア：値の右に ※、題のすぐ下（表の上）に印の意味（印が無ければどちらも出ない）', () => {
    const html = vnodeToHtml(panelToVNode(panelOf(['栄#2'])))
    // 値の欄の ※（印の意味の行の ※ と別に、印のある行の値の右）
    expect(html).toContain('74.8% ※')
    expect(html).not.toContain('73.9% ※')
    const note = html.indexOf('年齢不詳が多い駅')
    expect(note).toBeGreaterThan(-1)
    expect(note).toBeLessThan(html.indexOf('<table'))
    const plain = vnodeToHtml(panelToVNode(panelOf([])))
    expect(plain).not.toContain('※')
  })

  it('ECharts：副題に印の意味、印のある棒の値に ※', () => {
    const option = JSON.stringify(toEChartsDocument([panelOf(['矢場町#0'])]))
    expect(option).toContain('年齢不詳が多い駅')
    expect(option).toContain('73.9% ※')
    expect(JSON.stringify(toEChartsDocument([panelOf([])]))).not.toContain('※')
  })

  it('AI の要約（summarizePanels）：上位 5 駅に印があれば ※ と印の意味、無ければ以前と同じ', () => {
    const summary = summarizePanels([panelOf(['栄#2'])])
    expect(summary).toContain('1位 栄 74.8%※、2位 金山 73.9%、')
    expect(summary).toContain(` ｜ ${NOTICE_JA}`)
    expect(summarizePanels([panelOf([])])).not.toContain('※')
  })
})
