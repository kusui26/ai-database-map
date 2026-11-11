/**
 * エリア（行政区域・沿線）の値の出典——About に載せる一覧（2026-11-11・`docs/261110_fix_PLAN.md` §2.3）。
 *
 * エリアの要約のパネルは、出典を「出典（N）」の 1 行に畳む。出典の表示は利用条件なので、About には**全部**載せる。
 * 区域の指標のカタログ（`src/shared/catalog/area-catalog.json`）から束ねる——**手で書かない**（指標を足したら自動で
 * 増える・災害の出典 `hazardDataSources` と同じ作法）。
 *
 * 駅の円の値（駅の周り・駅から N m）の出典は駅の指標のカタログにあり、About の「データ出典」（`dataSources()`）が載せている。
 */

import { areaCatalog, type AreaMetric, type AreaSource } from '@/shared/area-catalog'
import { totalLabelJa } from './totals'

/** 区域の値の範囲。行政区域と沿線で、作り方も出典も違う。 */
const SCOPE_LABELS_JA = { admin: '行政区域', line: '沿線' } as const
type Scope = keyof typeof SCOPE_LABELS_JA

export type AreaDataSource = {
  readonly source: string
  readonly license: string
  /** どの範囲の値か（「行政区域」「沿線」）。 */
  readonly scopesJa: readonly string[]
  /** 何の値か（「人口」「将来推計人口」「事業所（民営）」「従業者（民営）」・カタログの並び）。 */
  readonly usedForJa: readonly string[]
}

type SourceUse = { readonly scope: Scope; readonly source: AreaSource; readonly labelJa: string }

/** 指標 1 つが使う出典（行政区域は必ず、沿線はあるときだけ）。 */
function usesOf(metric: AreaMetric): SourceUse[] {
  const labelJa = totalLabelJa(metric.baseMetric)
  const admin: SourceUse = { scope: 'admin', source: metric.sources.admin, labelJa }
  const line = metric.sources.line
  return line === null ? [admin] : [admin, { scope: 'line', source: line, labelJa }]
}

/** 束ねる鍵（出典と利用条件の組）。 */
function keyOf(use: SourceUse): string {
  return JSON.stringify([use.source.sourceJa, use.source.license])
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

/** 同じ鍵の使い方 → About の 1 行。 */
function sourceOf(uses: readonly SourceUse[]): AreaDataSource | null {
  const head = uses[0]
  if (head === undefined) return null
  return {
    source: head.source.sourceJa,
    license: head.source.license,
    scopesJa: unique(uses.map((use) => SCOPE_LABELS_JA[use.scope])),
    usedForJa: unique(uses.map((use) => use.labelJa)),
  }
}

/** (出典, 利用条件) ごとに束ねる（カタログの初出順）。 */
export function areaDataSources(
  metrics: readonly AreaMetric[] = areaCatalog.metrics,
): readonly AreaDataSource[] {
  const groups = metrics
    .flatMap(usesOf)
    .reduce(
      (map, use) => map.set(keyOf(use), [...(map.get(keyOf(use)) ?? []), use]),
      new Map<string, readonly SourceUse[]>(),
    )
  return [...groups.values()].flatMap((uses) => {
    const source = sourceOf(uses)
    return source === null ? [] : [source]
  })
}
