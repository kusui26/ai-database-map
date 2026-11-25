/**
 * エリアの要約の**年齢**（2026-11-25・`docs/261122_PLAN_population_improvement.md` §8.3〜8.4）。
 *
 * 区域の値に「生産年齢人口（15〜64歳）」と「高齢化率（65歳以上の割合）」の 2 行を足した。材料は本物の値の写し
 * （横浜市＝行政区域の公表値と推計・東急東横線の沿線＝メッシュの按分・竹橋から 5km＝駅の年齢の表）。ここで固定するのは：
 *
 * - 並び（人口 → 将来推計人口 → 生産年齢人口 → 高齢化率 → 事業所 → 従業者）と、それぞれの 1 行の文・作り方の名乗り
 * - 年齢の値が無い区域（浜松市の中央区・浜名区・年齢を入れる前の DB）は 2 行を出さず、ほかは以前と同じ
 * - 推計の無い区域（浜通り）・区分の欠けた年・人口 0 の年でも、作れる分だけを言う（作れない値を作らない）
 * - 出せない値の言い方（年齢の 4 区分は「年齢別の人口」1 つにまとめる）・比べる表の 3 行・注記・見ていないこと
 * - 駅から N m は駅の年齢の表のその半径だけを読む・AI の返却とビューアに同じ文が流れる
 */

import { describe, expect, it } from 'vitest'
import { areaCatalog, getAreaMetric, type AreaMetric } from '@/shared/area-catalog'
import { type AreaSummaryResponse, type AreaTotal } from '@/shared/area-summary'
import { type RadiusM } from '@/shared/constants'
import { type AreaRow } from '@/db/queries'
import {
  buildAreaSummaryResponse,
  missingText,
  type AreaSummaryParts,
} from '@/domain/area-summary/build'
import { ageCircleValues } from '@/domain/area-summary/near-age'
import { AGE_NOTE_JA, AREA_NOT_INCLUDED_JA } from '@/domain/area-summary/notes'
import { areaSummaryPanel } from '@/domain/area-summary/panel'
import { resolveStationStats } from '@/domain/area-summary/stations'
import { areaSummaryForLlm } from '@/ai/area-summary/for-llm'
import { summarizePanels } from '@/ai/assemble'
import { panelToVNode } from '@/shared/viewer/panels'
import { vnodeToHtml } from '@/shared/viewer/vnode'
import {
  TAKEBASHI,
  TAKEBASHI_5KM,
  TAKEBASHI_AGE_ROWS,
  TOYOKO_AGE,
  TOYOKO_ROWS,
  YOKOHAMA_AGE,
  YOKOHAMA_ROWS,
} from './fixtures/area-summary'

const RADIUS: RadiusM = 1000

function firstRow(rows: readonly AreaRow[]): AreaRow {
  const row = rows[0]
  if (row === undefined) throw new Error('固定データが空')
  return row
}

/** 区域の行に年齢の値を足す（年齢の無いキーは消す）。 */
function withAge(
  row: AreaRow,
  age: Readonly<Record<string, number>>,
  drop: readonly string[] = [],
): AreaRow {
  const values = new Map([...row.values, ...Object.entries(age)])
  for (const key of drop) values.delete(key)
  return { ...row, values }
}

function adminParts(row: AreaRow): AreaSummaryParts {
  return {
    area: { type: 'admin', ref: row.key, row, children: YOKOHAMA_ROWS.slice(1) },
    stationCount: 0,
    statRows: [],
    line: null,
    circle: null,
  }
}

function lineParts(row: AreaRow): AreaSummaryParts {
  return {
    area: { type: 'line', ref: row.key, row },
    stationCount: 0,
    statRows: [],
    line: null,
    circle: null,
  }
}

function responseOf(...parts: AreaSummaryParts[]): AreaSummaryResponse {
  return buildAreaSummaryResponse(parts, resolveStationStats(RADIUS, null), RADIUS, null)
}

function totalOf(response: AreaSummaryResponse, id: AreaTotal['id'], index = 0): AreaTotal {
  const total = response.areas[index]?.totals.find((each) => each.id === id)
  if (total === undefined) throw new Error(`${id} が無い`)
  return total
}

const YOKOHAMA = withAge(firstRow(YOKOHAMA_ROWS), YOKOHAMA_AGE)
const TOYOKO = withAge(firstRow(TOYOKO_ROWS), TOYOKO_AGE)
/** 推計の年齢のキー（浜通りの 13 市町村には無い）。 */
const AGE_PRED_KEYS = Object.keys(YOKOHAMA_AGE).filter((key) => key.includes('_pred_'))

describe('行政区域（横浜市）：公表値と推計の 2 行', () => {
  const response = responseOf(adminParts(YOKOHAMA))

  it('並びは 人口 → 将来推計人口 → 生産年齢人口 → 高齢化率 → 事業所 → 従業者', () => {
    expect(response.areas[0]?.totals.map((total) => total.id)).toEqual([
      'population',
      'populationFuture',
      'workingAge',
      'agingRate',
      'establishments',
      'employees',
    ])
  })

  it('生産年齢人口：2020 年の公表値 → 2050 年の推計と 2020 年比（社人研の起点と同じ 2020 年）', () => {
    const working = totalOf(response, 'workingAge')
    expect(working.headlineJa).toBe(
      '2,388,942 人（2020年）→ 2050年 1,964,819 人（推計・2020年比 -17.8%）',
    )
    expect(working).toMatchObject({
      labelJa: '生産年齢人口（15〜64歳）',
      unit: '人',
      method: 'officialAndProjection',
      methodJa: '公表値と推計',
      lead: { year: 2020, value: 2_388_942, valueJa: '2,388,942 人' },
      peak: null,
      accuracy: null,
    })
    expect(working.points.map((point) => `${point.year}:${point.kind}`)).toEqual([
      '2015:actual',
      '2020:actual',
      ...[2025, 2030, 2035, 2040, 2045, 2050].map((year) => `${year}:projection`),
    ])
    expect(
      working.changes.map((change) => `${change.fromYear}→${change.toYear} ${change.rateJa}`),
    ).toEqual(['2020→2050 -17.8%', '2015→2020 +0.2%'])
    expect(working.sourceJa).toContain('不詳補完結果')
    expect(working.sourceJa).toContain('将来推計人口メッシュ（R6')
  })

  it('高齢化率：25.1%（946,678 ÷ 3,777,491）→ 2050 年 34.4%。割合なので増減率は作らない', () => {
    const aging = totalOf(response, 'agingRate')
    expect(aging.headlineJa).toBe('25.1%（2020年）→ 34.4%（2050年・推計）')
    expect(aging).toMatchObject({
      labelJa: '高齢化率（65歳以上の割合）',
      unit: '%',
      method: 'officialAndProjection',
      changes: [],
      lead: { year: 2020, valueJa: '25.1%' },
    })
    expect(aging.lead.value).toBeCloseTo((946_678 / 3_777_491) * 100, 10)
    expect(aging.points).toHaveLength(8)
  })

  it('注記に年齢の読み方が 1 つ。見ていないことから「年齢構成」を外した（世帯の形は残る）', () => {
    expect(response.notesJa.filter((note) => note === AGE_NOTE_JA)).toHaveLength(1)
    expect(response.notIncludedJa.join('・')).not.toContain('年齢')
    expect(AREA_NOT_INCLUDED_JA).toContain('世帯の形')
  })

  it('出典に年齢の 2 つ（不詳補完結果・R6 の年齢）が載る', () => {
    const sources = response.sources.map((each) => each.source)
    expect(sources.some((source) => source.startsWith('総務省 国勢調査 不詳補完結果'))).toBe(true)
    expect(
      sources.some((source) => source.includes('の年齢別の人口を市区町村ごとに足したもの')),
    ).toBe(true)
  })
})

describe('沿線（東急東横線 1km）：メッシュの按分', () => {
  it('2 行とも「メッシュの按分」と名乗り、2020 年は国勢調査のメッシュ・2050 年は R6', () => {
    const response = responseOf(lineParts(TOYOKO))
    expect(totalOf(response, 'workingAge')).toMatchObject({
      headlineJa: '534,999 人（2020年）→ 2050年 490,026 人（推計・2020年比 -8.4%）',
      method: 'mesh',
      methodJa: 'メッシュの按分',
    })
    expect(totalOf(response, 'agingRate').headlineJa).toBe('18.6%（2020年）→ 27.6%（2050年・推計）')
  })
})

describe('年齢の値が欠けるとき（作れない値を作らない）', () => {
  it('年齢の値の無い区域（浜松市の中央区・浜名区・年齢を入れる前の DB）は 2 行を出さず、ほかは以前と同じ', () => {
    const without = responseOf(adminParts(firstRow(YOKOHAMA_ROWS)))
    expect(without.areas[0]?.totals.map((total) => total.id)).toEqual([
      'population',
      'populationFuture',
      'establishments',
      'employees',
    ])
    expect(without.notesJa).not.toContain(AGE_NOTE_JA)
  })

  it('推計の無い区域（浜通り）：生産年齢人口は 2015→2020 年の増減まで、高齢化率は 2020 年だけ。作り方は公表値', () => {
    const response = responseOf(
      adminParts(withAge(firstRow(YOKOHAMA_ROWS), YOKOHAMA_AGE, AGE_PRED_KEYS)),
    )
    expect(totalOf(response, 'workingAge')).toMatchObject({
      headlineJa: '2,388,942 人（2020年）・2015→2020年で +0.2%',
      method: 'official',
      methodJa: '公表値',
    })
    expect(totalOf(response, 'agingRate').headlineJa).toBe('25.1%（2020年）')
  })

  it('2050 年の区分が 1 つ欠ければ、その年の高齢化率は作らない（生産年齢人口の 2050 年は言う）', () => {
    const response = responseOf(
      adminParts(withAge(firstRow(YOKOHAMA_ROWS), YOKOHAMA_AGE, ['pop75_pred_2024_2050'])),
    )
    expect(totalOf(response, 'agingRate').headlineJa).toBe('25.1%（2020年）')
    expect(totalOf(response, 'workingAge').headlineJa).toContain('→ 2050年 1,964,819 人')
  })

  it('人口 0 の沿線：高齢化率は作らず、生産年齢人口は 0 人だけ（増減率にしない）', () => {
    const zero = Object.fromEntries(Object.keys(TOYOKO_AGE).map((key) => [key, 0]))
    const response = responseOf(lineParts(withAge(firstRow(TOYOKO_ROWS), zero)))
    const ids = response.areas[0]?.totals.map((total) => total.id) ?? []
    expect(ids).toContain('workingAge')
    expect(ids).not.toContain('agingRate')
    expect(totalOf(response, 'workingAge').headlineJa).toBe('0 人（2020年）')
  })
})

describe('出せない値の言い方（年齢の 4 区分は「年齢別の人口」1 つ）', () => {
  const keysOf = (match: (metric: AreaMetric) => boolean): string[] =>
    areaCatalog.metrics.filter(match).map((metric) => metric.key)
  const isAge = (metric: AreaMetric): boolean => /^pop(0_14|15_64|65_74|75)_/.test(metric.key)

  it('浜松市の中央区・浜名区：将来推計人口と年齢（実績も推計も）が同じ理由', () => {
    const keys = keysOf((metric) => metric.baseMetric === 'pop_pred' || isAge(metric))
    expect(missingText({ keys, reasonJa: '理由' })).toBe(
      '将来推計人口（2020〜2070年）・年齢別の人口（2015〜2050年）：理由',
    )
  })

  it('浜通り：年齢は推計の年だけ', () => {
    const keys = keysOf(
      (metric) => metric.baseMetric === 'pop_pred' || (isAge(metric) && metric.vintage !== null),
    )
    expect(missingText({ keys, reasonJa: '理由' })).toBe(
      '将来推計人口（2020〜2070年）・年齢別の人口（2025〜2050年）：理由',
    )
  })
})

describe('比べる表：生産年齢人口・その将来の増減・高齢化率の 3 行', () => {
  it('横浜市と東横線の沿線：3 行が将来推計人口の行の後に並ぶ', () => {
    const comparison = responseOf(adminParts(YOKOHAMA), lineParts(TOYOKO)).comparison
    const labels = comparison?.rows.map((row) => row.labelJa) ?? []
    const at = labels.indexOf('生産年齢人口（2020年）')
    expect(labels.slice(at, at + 3)).toEqual([
      '生産年齢人口（2020年）',
      '生産年齢人口の将来の増減（2020→2050年・推計）',
      '高齢化率（2020年 → 2050年）',
    ])
    expect(at).toBeGreaterThan(labels.indexOf('将来の増減（2020→2050年・推計）'))
    expect(comparison?.rows.slice(at, at + 3).map((row) => row.cells)).toEqual([
      ['2,388,942 人', '534,999 人'],
      ['-17.8%', '-8.4%'],
      ['25.1% → 34.4%', '18.6% → 27.6%'],
    ])
  })

  it('どのエリアにも年齢が無ければ 3 行を出さない（年齢を入れる前の DB と同じ表）', () => {
    const comparison = responseOf(
      adminParts(firstRow(YOKOHAMA_ROWS)),
      lineParts(firstRow(TOYOKO_ROWS)),
    ).comparison
    expect(comparison?.rows.map((row) => row.labelJa).join('・')).not.toContain('生産年齢人口')
  })
})

describe('駅から N m：駅の年齢の表のその半径だけ', () => {
  it('竹橋の 5km の 8 年 × 4 区分を、区域の指標の key へ（1km の行は読まない）', () => {
    const values = new Map(ageCircleValues(TAKEBASHI_AGE_ROWS, 5000))
    expect(values.size).toBe(32)
    expect([...values.keys()].every((key) => getAreaMetric(key) !== undefined)).toBe(true)
    expect(values.get('pop15_64_2020')).toBe(905_990)
    expect(values.get('pop75_pred_2024_2050')).toBe(207_863)
    expect(ageCircleValues(TAKEBASHI_AGE_ROWS, 2000)).toEqual([])
  })

  it('要約：駅の円の値と名乗り、出典は駅の年齢の指標の出典', () => {
    const circle = new Map([
      ...Object.entries(TAKEBASHI_5KM).map(([key, value]): [string, number] => [
        key.replace('_5km', ''),
        value,
      ]),
      ...ageCircleValues(TAKEBASHI_AGE_ROWS, 5000),
    ])
    const response = responseOf({
      area: { type: 'near', ref: 'near:竹橋#0@5000', origin: TAKEBASHI, withinM: 5000 },
      stationCount: 129,
      statRows: [],
      line: null,
      circle: new Map([...circle].filter(([key]) => getAreaMetric(key) !== undefined)),
    })
    expect(totalOf(response, 'workingAge')).toMatchObject({
      headlineJa: '905,990 人（2020年）→ 2050年 934,136 人（推計・2020年比 +3.1%）',
      method: 'stationRadius',
    })
    expect(totalOf(response, 'workingAge').sourceJa).toContain(
      '国勢調査 地域メッシュ統計（e-Stat 統計GIS',
    )
    expect(totalOf(response, 'workingAge').sourceJa).toContain('将来推計人口メッシュ')
  })
})

describe('AI の返却・チャットの要約・ビューアに同じ文が流れる', () => {
  const response = responseOf(adminParts(YOKOHAMA))

  it('AI（getAreaSummary・MCP の get_area_summary）：totals に 2 行（名前・文・作り方）', () => {
    const totals = areaSummaryForLlm(response, []).areas[0]?.totals ?? []
    expect(totals.map((total) => total.label)).toEqual([
      '人口',
      '将来推計人口',
      '生産年齢人口（15〜64歳）',
      '高齢化率（65歳以上の割合）',
      '事業所（民営）',
      '従業者（民営）',
    ])
    expect(totals[3]).toEqual({
      label: '高齢化率（65歳以上の割合）',
      headline: '25.1%（2020年）→ 34.4%（2050年・推計）',
      method: '公表値と推計',
    })
  })

  it('チャットの要約（パネルから作る）とビューアにも同じ文', () => {
    const panel = areaSummaryPanel(response, 'compact')
    const summary = summarizePanels([panel])
    expect(summary).toContain(
      '生産年齢人口（15〜64歳） 2,388,942 人（2020年）→ 2050年 1,964,819 人（推計・2020年比 -17.8%）［公表値と推計］',
    )
    const html = vnodeToHtml(panelToVNode(areaSummaryPanel(response)))
    expect(html).toContain('高齢化率（65歳以上の割合）')
    expect(html).toContain('25.1%（2020年）→ 34.4%（2050年・推計）')
  })
})
