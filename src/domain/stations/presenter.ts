/**
 * ドメイン：駅の値の束 → StationDetail（純関数）。
 *
 * station_bundle（key→value）を、カタログ駆動で「カテゴリ×半径×推計時点」の系列に組み立てる。
 * 各点は format 済み文字列と信頼性フラグ解決（reliabilityFlagKey の値＝1 か）を持つ。
 * フラグ列（kind='flag'）自体は系列にせず、フラグ解決の材料として使う。
 *
 * 年齢別の人口（`station_age_profile` の行・2026-11-25）は半径ごとにまとめて `ageStructure` に載せる。
 * 値の表の指標ではない（グラフにしか使わない）ので、系列には混ぜない。
 */

import { type CatalogEntry, entries } from '@/shared/catalog'
import {
  type AgeStructure,
  type MetricSeries,
  type StationDetail,
  type StationRow,
} from '@/shared/api'
import { formatNumber } from '@/shared/format'
import type { AgeProfileRow } from '@/db/queries'
import { baseMetricLabel } from '@/domain/metrics'

/** 系列としてプロットする種別（フラグは除外）。 */
const PLOTTABLE_KINDS = new Set(['level', 'growth', 'ratio', 'error'])

/** 系列のグループキー（同一指標ファミリ・半径・推計時点でまとめる）。 */
function groupKey(entry: CatalogEntry): string {
  return `${entry.baseMetric}|${entry.radiusM ?? 'none'}|${entry.vintage ?? 'none'}`
}

/** 年齢の行（半径 × 年）→ 半径ごと・年の昇順。行が無い（表に無い駅）なら null。 */
export function ageStructureOf(rows: readonly AgeProfileRow[]): AgeStructure | null {
  if (rows.length === 0) return null
  const radii = [...new Set(rows.map((row) => row.radiusM))].sort((a, b) => a - b)
  return {
    radii: radii.map((radiusM) => ({
      radiusM,
      years: rows
        .filter((row) => row.radiusM === radiusM)
        .sort((a, b) => a.year - b.year)
        .map(({ year, projected, counts, unknown }) => ({ year, projected, counts, unknown })),
    })),
  }
}

/** 駅の属性＋値の束（＋年齢の行）から StationDetail を組み立てる。 */
export function buildStationDetail(
  station: StationRow,
  values: ReadonlyMap<string, number>,
  ageRows: readonly AgeProfileRow[] = [],
): StationDetail {
  const groups = new Map<string, CatalogEntry[]>()
  for (const entry of entries) {
    if (!PLOTTABLE_KINDS.has(entry.kind)) continue
    if (!values.has(entry.key)) continue
    const key = groupKey(entry)
    const list = groups.get(key) ?? []
    list.push(entry)
    groups.set(key, list)
  }

  const series: MetricSeries[] = []
  for (const groupEntries of groups.values()) {
    const sorted = [...groupEntries].sort((a, b) => (a.year ?? 0) - (b.year ?? 0))
    const head = sorted[0]
    if (head === undefined) continue

    const points = sorted.map((entry) => {
      const value = values.get(entry.key) ?? null
      // バッジは notice 側で解く。除外（散布・ランキング）より広く、
      // 「値は使えるが読むとき注意が要る」ケースも拾う（260731）。
      const flagKey = entry.noticeFlagKey ?? entry.reliabilityFlagKey
      const flagged = flagKey !== null && values.get(flagKey) === 1
      const signed = entry.kind === 'growth' || entry.kind === 'error'
      return {
        key: entry.key,
        year: entry.year,
        yearBase: entry.yearBase,
        value,
        formatted: formatNumber(value, entry.format, { signed }),
        flagged,
      }
    })

    series.push({
      baseMetric: head.baseMetric,
      category: head.category,
      kind: head.kind,
      labelJa: baseMetricLabel(head.baseMetric),
      unit: head.unit,
      format: head.format,
      radiusM: head.radiusM,
      vintage: head.vintage,
      points,
    })
  }

  return { station, series, ageStructure: ageStructureOf(ageRows) }
}

/** 便宜：カテゴリ・半径で系列を絞り込む（UI タブ用）。 */
export function seriesFor(
  detail: StationDetail,
  category: string,
  radiusM: number | null,
): readonly MetricSeries[] {
  return detail.series.filter((s) => s.category === category && s.radiusM === radiusM)
}
