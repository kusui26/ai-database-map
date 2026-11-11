/**
 * About に載せるエリア（行政区域・沿線）の値の出典（`src/domain/area-summary/sources.ts`・2026-11-11・
 * `docs/261110_fix_PLAN.md` §2.3・§10.4）。
 *
 * エリアの要約と駅周辺のプロフィールは、画面では出典を「出典（N）」の 1 行に畳む。出典の表示は利用条件なので、
 * **応答に載る出典はすべて About にある**ことをここで固定する。About は駅の指標の出典（`dataSources()`）と、
 * 区域の指標の出典（`areaDataSources()`）の 2 つを載せる。以前は後者が無く、横浜市の要約の出典 9 件のうち 5 件が About に無かった。
 */

import { describe, expect, it } from 'vitest'
import { areaCatalog, getAreaMetric, type AreaMetric } from '@/shared/area-catalog'
import { type RadiusM } from '@/shared/constants'
import { dataSources } from '@/domain/sources'
import { areaDataSources } from '@/domain/area-summary/sources'
import { totalLabelJa } from '@/domain/area-summary/totals'
import { buildAreaSummaryResponse, type AreaSummaryParts } from '@/domain/area-summary/build'
import { type ResolvedArea } from '@/domain/area-summary/resolve'
import { resolveStationStats } from '@/domain/area-summary/stations'
import { defaultColorEntry } from '@/domain/style/color-metric'
import {
  TAKEBASHI,
  TAKEBASHI_5KM,
  TOYOKO_ROWS,
  YOKOHAMA_ROWS,
  YOKOHAMA_STATION_STATS,
} from './fixtures/area-summary'

const RADIUS: RadiusM = 1000
/** 区域の値の種類（カタログの baseMetric）。 */
const BASES: readonly AreaMetric['baseMetric'][] = ['pop', 'pop_pred', 'estab_n', 'emp_n']
const STATS = resolveStationStats(RADIUS, defaultColorEntry(RADIUS))

/** カタログが持つ出典の組（出典・利用条件）。About と見比べる元。 */
function catalogPairs(): Set<string> {
  return new Set(
    areaCatalog.metrics.flatMap(({ sources }) =>
      [sources.admin, sources.line].flatMap((source) =>
        source === null ? [] : [JSON.stringify([source.sourceJa, source.license])],
      ),
    ),
  )
}

/** About に載る出典の名前（駅の指標＋エリアの値）。 */
function aboutSourceNames(): Set<string> {
  return new Set([
    ...dataSources().map((each) => each.source),
    ...areaDataSources().map((each) => each.source),
  ])
}

function firstRow<T>(rows: readonly T[]): T {
  const row = rows[0]
  if (row === undefined) throw new Error('固定データが空')
  return row
}

/** 応答を組み立てる材料（`tests/domain-area-summary.test.ts` と同じ写し方）。 */
function parts(area: ResolvedArea, overrides: Partial<AreaSummaryParts> = {}): AreaSummaryParts {
  return { area, stationCount: 0, statRows: [], line: null, circle: null, ...overrides }
}

/** 駅の円の値（`station_bundle`）→ 区域の指標の key（`load.ts` の circleParts と同じ写し方）。 */
function circleOf(bundle: Readonly<Record<string, number>>, suffix: string): Map<string, number> {
  return new Map(
    Object.entries(bundle)
      .map(([key, value]): [string, number] => [key.replace(suffix, ''), value])
      .filter(
        ([key]) => getAreaMetric(key)?.sources.line !== null && getAreaMetric(key) !== undefined,
      ),
  )
}

describe('About のエリアの値の出典（areaDataSources）', () => {
  it('区域の指標のカタログの出典を、(出典・利用条件) の組で 1 つずつ載せる（重ねない・落とさない）', () => {
    const about = areaDataSources().map((each) => JSON.stringify([each.source, each.license]))
    expect(new Set(about).size).toBe(about.length)
    expect(new Set(about)).toEqual(catalogPairs())
  })

  it('2026-11 のカタログでは 8 種類（行政区域 5・沿線 3）', () => {
    const sources = areaDataSources()
    expect(sources).toHaveLength(8)
    expect(sources.filter((each) => each.scopesJa.includes('行政区域'))).toHaveLength(5)
    expect(sources.filter((each) => each.scopesJa.includes('沿線'))).toHaveLength(3)
  })

  it('札は画面の「エリア全体の値」と同じ言葉で、範囲（行政区域・沿線）を添える', () => {
    const allowed = new Set(BASES.map((base) => totalLabelJa(base)))
    for (const each of areaDataSources()) {
      expect(each.usedForJa.length, each.source).toBeGreaterThan(0)
      expect(
        each.usedForJa.every((label) => allowed.has(label)),
        each.source,
      ).toBe(true)
      expect(each.scopesJa.every((scope) => scope === '行政区域' || scope === '沿線')).toBe(true)
      expect(each.license.length, each.source).toBeGreaterThan(0)
    }
    const census = areaDataSources().find((each) =>
      each.source.startsWith('経済センサス‐活動調査（'),
    )
    expect(census?.usedForJa).toEqual(['事業所（民営）', '従業者（民営）'])
  })
})

describe('応答に載る出典は、すべて About にある（261110 §10.4）', () => {
  const cases: readonly [string, AreaSummaryParts][] = [
    [
      '横浜市（行政区域・駅の周りつき）',
      parts(
        {
          type: 'admin',
          ref: firstRow(YOKOHAMA_ROWS).key,
          row: firstRow(YOKOHAMA_ROWS),
          children: YOKOHAMA_ROWS.slice(1),
        },
        {
          stationCount: YOKOHAMA_STATION_STATS.stationCount,
          statRows: YOKOHAMA_STATION_STATS.stats,
        },
      ),
    ],
    [
      '東急東横線の沿線',
      parts(
        { type: 'line', ref: firstRow(TOYOKO_ROWS).key, row: firstRow(TOYOKO_ROWS) },
        { stationCount: 21 },
      ),
    ],
    [
      '竹橋から 5km（駅の円の値）',
      parts(
        { type: 'near', ref: 'near:竹橋#0@5000', origin: TAKEBASHI, withinM: 5000 },
        { stationCount: 129, circle: circleOf(TAKEBASHI_5KM, '_5km') },
      ),
    ],
  ]

  it.each(cases)('%s', (_name, input) => {
    const response = buildAreaSummaryResponse([input], STATS, RADIUS, null)
    expect(response.sources.length).toBeGreaterThan(0)
    const about = aboutSourceNames()
    const missing = response.sources.filter((each) => !about.has(each.source))
    expect(missing).toEqual([])
  })
})
